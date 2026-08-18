/**
 * Wind field + point cache. Forecast field is MSC GeoMet GEM
 * (HRDPS, then RDPS, then GDPS). History still uses Open-Meteo.
 * Keep the grid in sync with apps/web/src/lib/windField.ts.
 */
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { repoRoot, WIND_CACHE_DIR } from "./env.ts";
import { fetchGeometForecastField } from "./geometWind.ts";
import {
  NCOLS,
  NORTH,
  NROWS,
  STEP_LAT,
  STEP_LON,
  WEST,
  fieldExtent,
} from "./windGrid.ts";

const FORECAST_URL = "https://api.open-meteo.com/v1/gem";
const HISTORICAL_URL =
  "https://historical-forecast-api.open-meteo.com/v1/forecast";
/** Stay under Open-Meteo “too much data” on 8-day multi-point POSTs. */
const BATCH_SIZE = 40;
const BATCH_GAP_MS = 1500;
/** Open-Meteo history samples every 0.5° on the 0.1° grid. */
const OM_STRIDE = Math.round(0.5 / STEP_LAT);
const FORECAST_TTL_MS = 60 * 60 * 1000;
const POINT_FORECAST_TTL_MS = 60 * 60 * 1000;
const HRDPS_HANDOFF_MS = 2 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FIELD_CACHE_PREFIX = "ab-0p1-gem";

type GemHourly = {
  latitude?: number;
  longitude?: number;
  hourly?: Record<string, Array<number | string | null> | undefined>;
};

export type WindFieldJson = {
  west: number;
  south: number;
  east: number;
  north: number;
  dlon: number;
  dlat: number;
  ncols: number;
  nrows: number;
  times: string[];
  speed: Array<number | null>;
  dir: Array<number | null>;
  fetchedAt: string;
  source: "open-meteo" | "geomet-hrdps" | "geomet-gem";
  kind: "forecast" | "history";
};

export type WindHourJson = {
  time: string;
  windSpeedMps: number;
  windDirDeg: number;
  gustMps: number | null;
  weatherCode: number | null;
  precipMm: number;
};

export type WindForecastJson = {
  model: string;
  hours: WindHourJson[];
  date?: string;
  fetchedAt: string;
  source: "open-meteo";
};

export type CacheStatus = "hit" | "miss" | "stale";

type CacheFile<T> = T & { fetchedAt: string };

const inflight = new Map<string, Promise<unknown>>();

function coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function isIsoDate(value: string): boolean {
  return DATE_RE.test(value);
}

function fieldSize(): { ncols: number; nrows: number } {
  return { ncols: NCOLS, nrows: NROWS };
}

function openMeteoPoints(): Array<{
  i: number;
  j: number;
  lat: number;
  lon: number;
}> {
  return points().filter(
    (p) => p.i % OM_STRIDE === 0 && p.j % OM_STRIDE === 0,
  );
}

type Ring = number[][];
type Poly = Ring[];

function ringContains(ring: Ring, lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    const hit =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function loadAlbertaOutline(): Poly[] {
  const p = path.join(repoRoot, "apps/web/src/data/albertaMask.json");
  const fc = JSON.parse(readFileSync(p, "utf8")) as {
    features: Array<{
      properties?: { kind?: string };
      geometry?: { type: string; coordinates: unknown };
    }>;
  };
  const f = fc.features.find((x) => x.properties?.kind === "outline");
  const g = f?.geometry;
  if (!g) return [];
  if (g.type === "Polygon") return [g.coordinates as Poly];
  if (g.type === "MultiPolygon") return g.coordinates as Poly[];
  return [];
}

const ALBERTA_OUTLINE = loadAlbertaOutline();

function pointInAlberta(lon: number, lat: number): boolean {
  if (ALBERTA_OUTLINE.length === 0) return true;
  for (const poly of ALBERTA_OUTLINE) {
    const outer = poly[0];
    if (!outer || !ringContains(outer, lon, lat)) continue;
    let hole = false;
    for (let i = 1; i < poly.length; i++) {
      if (ringContains(poly[i]!, lon, lat)) hole = true;
    }
    if (!hole) return true;
  }
  return false;
}

function points(): Array<{ i: number; j: number; lat: number; lon: number }> {
  const { ncols, nrows } = fieldSize();
  const out = [];
  for (let j = 0; j < nrows; j++) {
    for (let i = 0; i < ncols; i++) {
      const lat = NORTH - j * STEP_LAT;
      const lon = WEST + i * STEP_LON;
      if (!pointInAlberta(lon, lat)) continue;
      out.push({ i, j, lat, lon });
    }
  }
  return out;
}

function hourlySeries(
  hourly: GemHourly["hourly"],
  name: string,
): Array<number | null> {
  if (!hourly) return [];
  const direct = hourly[name];
  if (
    Array.isArray(direct) &&
    (direct.length === 0 || typeof direct[0] !== "string")
  ) {
    return direct as Array<number | null>;
  }
  const key = Object.keys(hourly).find(
    (k) => k === name || k.startsWith(`${name}_`),
  );
  const series = key ? hourly[key] : undefined;
  if (!Array.isArray(series)) return [];
  return series.map((v) => (typeof v === "number" ? v : null));
}

function alignBatch(
  chunk: Array<{ lat: number; lon: number }>,
  batch: GemHourly[],
): GemHourly[] {
  const unused = batch.map((_, i) => i);
  const aligned: GemHourly[] = new Array(chunk.length);
  for (let k = 0; k < chunk.length; k++) {
    const p = chunk[k]!;
    let bestU = 0;
    let bestD = Infinity;
    for (let u = 0; u < unused.length; u++) {
      const row = batch[unused[u]!]!;
      if (row.latitude == null || row.longitude == null) continue;
      const dlat = row.latitude - p.lat;
      const dlon = row.longitude - p.lon;
      const d = dlat * dlat + dlon * dlon;
      if (d < bestD) {
        bestD = d;
        bestU = u;
      }
    }
    const idx = unused.splice(bestU, 1)[0]!;
    aligned[k] = batch[idx]!;
  }
  return aligned;
}

function fieldRequestBody(
  kind: "forecast" | "history",
  pts: Array<{ lat: number; lon: number }>,
  startDate?: string,
  endDate?: string,
): Record<string, unknown> {
  const n = pts.length;
  const model = kind === "history" ? "gem_hrdps_continental" : "gem_seamless";
  const body: Record<string, unknown> = {
    latitude: pts.map((p) => Number(p.lat.toFixed(3))),
    longitude: pts.map((p) => Number(p.lon.toFixed(3))),
    hourly: ["wind_speed_10m", "wind_direction_10m"],
    wind_speed_unit: "ms",
    timezone: Array.from({ length: n }, () => "America/Edmonton"),
    models: Array.from({ length: n }, () => model),
  };
  if (kind === "history" && startDate && endDate) {
    body.start_date = startDate;
    body.end_date = endDate;
  } else {
    body.forecast_days = 7;
    body.past_days = 1;
  }
  return body;
}

async function fetchLocationBatch(
  kind: "forecast" | "history",
  pts: Array<{ lat: number; lon: number }>,
  startDate?: string,
  endDate?: string,
): Promise<GemHourly[]> {
  const url = kind === "history" ? HISTORICAL_URL : FORECAST_URL;
  const body = JSON.stringify(fieldRequestBody(kind, pts, startDate, endDate));
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await delay(1500 * 2 ** (attempt - 1));
    const res = await globalThis.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`Open-Meteo wind field error ${res.status}`);
      continue;
    }
    if (!res.ok) throw new Error(`Open-Meteo wind field error ${res.status}`);
    const data = (await res.json()) as GemHourly | GemHourly[];
    const rows = Array.isArray(data) ? data : [data];
    if (rows.length !== pts.length) {
      throw new Error(`Wind field size ${rows.length} != ${pts.length}`);
    }
    return alignBatch(pts, rows);
  }
  throw lastErr ?? new Error("Open-Meteo wind field error");
}

async function fetchOpenMeteoField(
  kind: "forecast" | "history",
  startDate?: string,
  endDate?: string,
): Promise<WindFieldJson> {
  const pts = openMeteoPoints();
  const { ncols, nrows } = fieldSize();
  const ncells = ncols * nrows;
  console.log(
    `wind field Open-Meteo ${kind} ${pts.length}/${ncells} Alberta cells`,
  );
  const rows: GemHourly[] = [];
  const batches = Math.ceil(pts.length / BATCH_SIZE);
  for (let i = 0; i < pts.length; i += BATCH_SIZE) {
    if (i > 0) await delay(BATCH_GAP_MS);
    const chunk = pts.slice(i, i + BATCH_SIZE);
    console.log(
      `wind field batch ${Math.floor(i / BATCH_SIZE) + 1}/${batches} (${chunk.length} pts)`,
    );
    rows.push(
      ...(await fetchLocationBatch(
        kind,
        chunk,
        startDate,
        endDate,
      )),
    );
  }
  const times = (rows[0]?.hourly?.time ?? []).filter(
    (t): t is string => typeof t === "string",
  );
  if (times.length === 0) throw new Error("Wind field returned no hours");
  const speed: Array<number | null> = Array.from(
    { length: times.length * ncells },
    () => null,
  );
  const dir: Array<number | null> = Array.from(
    { length: times.length * ncells },
    () => null,
  );
  for (let p = 0; p < pts.length; p++) {
    const cell = pts[p]!;
    const hourly = rows[p]?.hourly;
    const spd = hourlySeries(hourly, "wind_speed_10m");
    const deg = hourlySeries(hourly, "wind_direction_10m");
    const idx0 = cell.j * ncols + cell.i;
    for (let t = 0; t < times.length; t++) {
      const s = spd[t];
      const d = deg[t];
      const idx = t * ncells + idx0;
      if (s != null && d != null) {
        speed[idx] = s;
        dir[idx] = d;
      }
    }
  }
  return {
    ...fieldExtent(),
    dlon: STEP_LON,
    dlat: STEP_LAT,
    ncols,
    nrows,
    times,
    speed,
    dir,
    fetchedAt: new Date().toISOString(),
    source: "open-meteo",
    kind,
  };
}

type PointHourly = {
  time?: string[];
  wind_speed_10m?: Array<number | null>;
  wind_direction_10m?: Array<number | null>;
  wind_gusts_10m?: Array<number | null>;
  weather_code?: Array<number | null>;
  precipitation?: Array<number | null>;
};

function parsePointHours(hourly?: PointHourly): WindHourJson[] {
  const t = hourly?.time ?? [];
  const spd = hourly?.wind_speed_10m ?? [];
  const dir = hourly?.wind_direction_10m ?? [];
  const gust = hourly?.wind_gusts_10m ?? [];
  const code = hourly?.weather_code ?? [];
  const precip = hourly?.precipitation ?? [];
  const hours: WindHourJson[] = [];
  for (let i = 0; i < t.length; i++) {
    const windSpeedMps = spd[i];
    const windDirDeg = dir[i];
    if (windSpeedMps == null || windDirDeg == null) continue;
    hours.push({
      time: t[i]!,
      windSpeedMps,
      windDirDeg,
      gustMps: gust[i] ?? null,
      weatherCode: code[i] ?? null,
      precipMm: precip[i] ?? 0,
    });
  }
  return hours;
}

async function fetchOpenMeteoPoint(
  lat: number,
  lon: number,
  startDate?: string,
  endDate?: string,
): Promise<WindForecastJson> {
  const historical = Boolean(startDate && endDate);
  const url = new URL(historical ? HISTORICAL_URL : FORECAST_URL);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set(
    "hourly",
    "wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,precipitation",
  );
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set(
    "models",
    historical ? "gem_hrdps_continental" : "gem_seamless",
  );
  if (historical) {
    url.searchParams.set("start_date", startDate!);
    url.searchParams.set("end_date", endDate!);
  } else {
    url.searchParams.set("forecast_days", "7");
    url.searchParams.set("past_days", "1");
  }
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await delay(800 * 2 ** (attempt - 1));
    const res = await globalThis.fetch(url);
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`Open-Meteo error ${res.status}`);
      continue;
    }
    if (!res.ok) throw new Error(`Open-Meteo error ${res.status}`);
    const data = (await res.json()) as { hourly?: PointHourly };
    const hours = parsePointHours(data.hourly);
    if (historical && hours.length === 0) {
      throw new Error(`No HRDPS hours returned for ${startDate}–${endDate}`);
    }
    return {
      model: historical ? "gem_hrdps_continental" : "gem_seamless",
      hours,
      date:
        historical && startDate && endDate
          ? startDate === endDate
            ? startDate
            : `${startDate}/${endDate}`
          : undefined,
      fetchedAt: new Date().toISOString(),
      source: "open-meteo",
    };
  }
  throw lastErr ?? new Error("Open-Meteo error");
}

async function ensureCacheDir(): Promise<void> {
  await mkdir(WIND_CACHE_DIR, { recursive: true });
}

function cachePath(name: string): string {
  return path.join(WIND_CACHE_DIR, name);
}

async function readCache<T extends CacheFile<unknown>>(
  name: string,
): Promise<T | null> {
  try {
    const raw = await readFile(cachePath(name), "utf8");
    const parsed = JSON.parse(raw) as T;
    if (typeof parsed.fetchedAt !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(name: string, data: unknown): Promise<void> {
  await ensureCacheDir();
  const dest = cachePath(name);
  const tmp = `${dest}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data), "utf8");
  await rename(tmp, dest);
}

function isFresh(fetchedAt: string, ttlMs: number): boolean {
  if (!Number.isFinite(ttlMs) || ttlMs === Infinity) return true;
  const t = Date.parse(fetchedAt);
  return Number.isFinite(t) && Date.now() - t < ttlMs;
}

async function cached<T extends CacheFile<unknown>>(opts: {
  key: string;
  file: string;
  ttlMs: number;
  load: () => Promise<T>;
}): Promise<{ data: T; cache: CacheStatus }> {
  return coalesce(opts.key, async () => {
    const hit = await readCache<T>(opts.file);
    if (hit && isFresh(hit.fetchedAt, opts.ttlMs)) {
      return { data: hit, cache: "hit" as const };
    }
    try {
      const fresh = await opts.load();
      await writeCache(opts.file, fresh);
      console.log(`wind cache miss ${opts.file}`);
      return { data: fresh, cache: "miss" as const };
    } catch (err) {
      if (hit) {
        console.warn(`wind cache stale ${opts.file}`, err);
        return { data: hit, cache: "stale" as const };
      }
      throw err;
    }
  });
}

export async function getForecastField(): Promise<{
  data: WindFieldJson;
  cache: CacheStatus;
}> {
  return cached({
    key: `field-forecast-${FIELD_CACHE_PREFIX}`,
    file: `field-forecast-${FIELD_CACHE_PREFIX}.json`,
    ttlMs: FORECAST_TTL_MS,
    load: () => fetchGeometForecastField(),
  });
}

export async function getHistoryField(
  startDate: string,
  endDate: string,
): Promise<{ data: WindFieldJson; cache: CacheStatus }> {
  const file = `field-history-${FIELD_CACHE_PREFIX}-${startDate}_${endDate}.json`;
  return cached({
    key: file,
    file,
    ttlMs: Infinity,
    load: () => fetchOpenMeteoField("history", startDate, endDate),
  });
}

function pointKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)}_${lon.toFixed(3)}`;
}

function nearestFieldTimeIndex(times: string[], timeIso: string): number {
  if (times.length === 0) return -1;
  const exact = times.indexOf(timeIso);
  if (exact >= 0) return exact;
  const target = Date.parse(timeIso);
  if (!Number.isFinite(target)) return 0;
  let best = 0;
  let bestAbs = Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = Date.parse(times[i]!);
    if (!Number.isFinite(t)) continue;
    const d = Math.abs(t - target);
    if (d < bestAbs) {
      bestAbs = d;
      best = i;
    }
  }
  return best;
}

function sampleCachedField(
  field: WindFieldJson,
  timeIso: string,
  lat: number,
  lon: number,
): { speed: number; dir: number } | null {
  const t = nearestFieldTimeIndex(field.times, timeIso);
  if (t < 0) return null;
  const target = Date.parse(timeIso);
  const got = Date.parse(field.times[t]!);
  if (
    Number.isFinite(target) &&
    Number.isFinite(got) &&
    Math.abs(got - target) > HRDPS_HANDOFF_MS
  ) {
    return null;
  }
  const { ncols, nrows, west, south, east, north } = field;
  if (east === west || north === south) return null;
  if (lon < west || lon > east || lat < south || lat > north) return null;
  const n = ncols * nrows;
  const fx = ((lon - west) / (east - west)) * ncols - 0.5;
  const fy = ((north - lat) / (north - south)) * nrows - 0.5;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  const tx = fx - i0;
  const ty = fy - j0;
  const at = (i: number, j: number): { s: number; d: number } | null => {
    if (i < 0 || j < 0 || i >= ncols || j >= nrows) return null;
    const idx = t * n + j * ncols + i;
    const s = field.speed[idx];
    const d = field.dir[idx];
    if (s == null || d == null || !Number.isFinite(s) || !Number.isFinite(d)) {
      return null;
    }
    return { s, d };
  };
  const a = at(i0, j0);
  const b = at(i0 + 1, j0);
  const c = at(i0, j0 + 1);
  const d = at(i0 + 1, j0 + 1);
  const parts: Array<{ s: number; d: number; w: number }> = [];
  if (a) parts.push({ ...a, w: (1 - tx) * (1 - ty) });
  if (b) parts.push({ ...b, w: tx * (1 - ty) });
  if (c) parts.push({ ...c, w: (1 - tx) * ty });
  if (d) parts.push({ ...d, w: tx * ty });
  let wsum = 0;
  let s = 0;
  let ux = 0;
  let uy = 0;
  for (const p of parts) {
    if (p.w <= 0) continue;
    wsum += p.w;
    s += p.s * p.w;
    const r = (p.d * Math.PI) / 180;
    ux += Math.sin(r) * p.w;
    uy += Math.cos(r) * p.w;
  }
  if (wsum <= 0) return a ? { speed: a.s, dir: a.d } : null;
  return {
    speed: s / wsum,
    dir: ((Math.atan2(ux, uy) * 180) / Math.PI + 360) % 360,
  };
}

async function overlayHrdpsIfCached(
  hours: WindHourJson[],
  lat: number,
  lon: number,
): Promise<WindHourJson[]> {
  const hit = await readCache<WindFieldJson>(
    `field-forecast-${FIELD_CACHE_PREFIX}.json`,
  );
  if (!hit || hours.length === 0) return hours;
  return hours.map((h) => {
    const s = sampleCachedField(hit, h.time, lat, lon);
    if (!s) return h;
    return { ...h, windSpeedMps: s.speed, windDirDeg: s.dir };
  });
}

export async function getPointForecast(
  lat: number,
  lon: number,
): Promise<{ data: WindForecastJson; cache: CacheStatus }> {
  const file = `point-${pointKey(lat, lon)}-forecast.json`;
  const result = await cached({
    key: file,
    file,
    ttlMs: POINT_FORECAST_TTL_MS,
    load: () => fetchOpenMeteoPoint(lat, lon),
  });
  void getForecastField().catch((err) =>
    console.warn("wind field warmup", err),
  );
  const hours = await overlayHrdpsIfCached(result.data.hours, lat, lon);
  return {
    data: {
      ...result.data,
      hours,
      model: "hrdps_then_gem_seamless",
    },
    cache: result.cache,
  };
}

export async function getPointHistory(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
): Promise<{ data: WindForecastJson; cache: CacheStatus }> {
  const file = `point-${pointKey(lat, lon)}-${startDate}_${endDate}.json`;
  return cached({
    key: file,
    file,
    ttlMs: Infinity,
    load: () => fetchOpenMeteoPoint(lat, lon, startDate, endDate),
  });
}
