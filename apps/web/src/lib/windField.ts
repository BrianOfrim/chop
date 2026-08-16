import type { WindHour } from "./wind";

/** Temporary: HRDPS samples within 20 km of Pigeon Lake only (not the whole province). */
const PIGEON_LAT = 53.03028;
const PIGEON_LON = -114.06333;
const WIND_FIELD_RADIUS_M = 20_000;
/** 8 cells across the 40 km box → 9×9 = 81 points, ~5 km spacing. */
const WIND_FIELD_CELLS = 8;

const mPerDegLat = 110_574;
const mPerDegLon =
  111_320 * Math.cos((PIGEON_LAT * Math.PI) / 180);
const dlat = WIND_FIELD_RADIUS_M / mPerDegLat;
const dlon = WIND_FIELD_RADIUS_M / mPerDegLon;

export const WIND_FIELD_WEST = PIGEON_LON - dlon;
export const WIND_FIELD_EAST = PIGEON_LON + dlon;
export const WIND_FIELD_SOUTH = PIGEON_LAT - dlat;
export const WIND_FIELD_NORTH = PIGEON_LAT + dlat;
export const WIND_FIELD_STEP_LAT = (2 * dlat) / WIND_FIELD_CELLS;
export const WIND_FIELD_STEP_LON = (2 * dlon) / WIND_FIELD_CELLS;
/** Nominal sample spacing (m); lon/lat degree steps differ so cells stay ~this. */
export const WIND_FIELD_STEP_M = (2 * WIND_FIELD_RADIUS_M) / WIND_FIELD_CELLS;
/** @deprecated equal-degree step; lon/lat steps differ so cells stay ~5 km. */
export const WIND_FIELD_STEP = WIND_FIELD_STEP_LAT;

const FORECAST_URL = "https://api.open-meteo.com/v1/gem";
const HISTORICAL_URL =
  "https://historical-forecast-api.open-meteo.com/v1/forecast";
/** One 81-point Pigeon box fits in a single POST. */
const MAX_LOCATIONS = 1000;
const BATCH_SIZE = 100;
const BATCH_GAP_MS = 1100;

type GemHourly = {
  latitude?: number;
  longitude?: number;
  hourly?: Record<string, Array<number | string | null> | undefined>;
};

function hourlySeries(
  hourly: GemHourly["hourly"],
  name: string,
): Array<number | null> {
  if (!hourly) return [];
  const direct = hourly[name];
  if (Array.isArray(direct) && (direct.length === 0 || typeof direct[0] !== "string")) {
    return direct as Array<number | null>;
  }
  const key = Object.keys(hourly).find(
    (k) => k === name || k.startsWith(`${name}_`),
  );
  const series = key ? hourly[key] : undefined;
  if (!Array.isArray(series)) return [];
  return series.map((v) => (typeof v === "number" ? v : null));
}

export type WindField = {
  west: number;
  south: number;
  east: number;
  north: number;
  dlon: number;
  dlat: number;
  ncols: number;
  nrows: number;
  times: string[];
  /** Row-major, north-first: `t * ncells + j * ncols + i`. */
  speed: Float32Array;
  dir: Float32Array;
};

export type WindFieldSlice = {
  west: number;
  south: number;
  east: number;
  north: number;
  dlon: number;
  dlat: number;
  ncols: number;
  nrows: number;
  time: string;
  speed: Float32Array;
  dir: Float32Array;
  /** True when every cell is the single lake/sim wind, not a spatial field. */
  uniform?: boolean;
};

export function windFieldSize(): { ncols: number; nrows: number } {
  return { ncols: WIND_FIELD_CELLS + 1, nrows: WIND_FIELD_CELLS + 1 };
}

export function windFieldExtent(): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  return {
    west: WIND_FIELD_WEST - WIND_FIELD_STEP_LON / 2,
    east: WIND_FIELD_EAST + WIND_FIELD_STEP_LON / 2,
    south: WIND_FIELD_SOUTH - WIND_FIELD_STEP_LAT / 2,
    north: WIND_FIELD_NORTH + WIND_FIELD_STEP_LAT / 2,
  };
}

export function windGridLon(i: number): number {
  return WIND_FIELD_WEST + i * WIND_FIELD_STEP_LON;
}

export function windGridLat(j: number): number {
  return WIND_FIELD_NORTH - j * WIND_FIELD_STEP_LAT;
}

function points(): Array<{ i: number; j: number; lat: number; lon: number }> {
  const { ncols, nrows } = windFieldSize();
  const out = [];
  for (let j = 0; j < nrows; j++) {
    for (let i = 0; i < ncols; i++) {
      out.push({ i, j, lat: windGridLat(j), lon: windGridLon(i) });
    }
  }
  return out;
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
  const model =
    kind === "history" ? "gem_hrdps_continental" : "gem_seamless";
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

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
    if (attempt > 0) {
      await delay(1500 * 2 ** (attempt - 1));
    }
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

async function fetchLocations(
  kind: "forecast" | "history",
  pts: Array<{ lat: number; lon: number }>,
  startDate?: string,
  endDate?: string,
): Promise<GemHourly[]> {
  if (pts.length === 0) return [];
  if (pts.length > MAX_LOCATIONS) {
    throw new Error(`Wind field has ${pts.length} points; max is ${MAX_LOCATIONS}`);
  }
  const out: GemHourly[] = [];
  for (let i = 0; i < pts.length; i += BATCH_SIZE) {
    if (i > 0) await delay(BATCH_GAP_MS);
    const chunk = pts.slice(i, i + BATCH_SIZE);
    out.push(...(await fetchLocationBatch(kind, chunk, startDate, endDate)));
  }
  return out;
}

async function fetchAlbertaWindFieldWith(
  kind: "forecast" | "history",
  startDate?: string,
  endDate?: string,
): Promise<WindField> {
  const pts = points();
  const { ncols, nrows } = windFieldSize();
  const ncells = ncols * nrows;
  const rows = await fetchLocations(kind, pts, startDate, endDate);

  const times = (rows[0]?.hourly?.time ?? []).filter(
    (t): t is string => typeof t === "string",
  );
  if (times.length === 0) throw new Error("Wind field returned no hours");
  const speed = new Float32Array(times.length * ncells);
  const dir = new Float32Array(times.length * ncells);
  speed.fill(Number.NaN);
  dir.fill(Number.NaN);

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

  const extent = windFieldExtent();
  return {
    ...extent,
    dlon: WIND_FIELD_STEP_LON,
    dlat: WIND_FIELD_STEP_LAT,
    ncols,
    nrows,
    times,
    speed,
    dir,
  };
}

let forecastFieldPromise: Promise<WindField> | null = null;

export function fetchAlbertaWindField(): Promise<WindField> {
  if (!forecastFieldPromise) {
    forecastFieldPromise = fetchAlbertaWindFieldWith("forecast").catch(
      (err) => {
        forecastFieldPromise = null;
        throw err;
      },
    );
  }
  return forecastFieldPromise;
}

export function fetchAlbertaWindFieldRange(
  startDate: string,
  endDate: string,
): Promise<WindField> {
  return fetchAlbertaWindFieldWith("history", startDate, endDate);
}

function nearestTimeIndex(times: string[], timeIso: string): number {
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

export function sliceWindField(
  field: WindField,
  timeIso: string,
  maxDeltaMs: number = 90 * 60 * 1000,
): WindFieldSlice | null {
  const t = nearestTimeIndex(field.times, timeIso);
  if (t < 0) return null;
  if (Number.isFinite(maxDeltaMs)) {
    const target = Date.parse(timeIso);
    const got = Date.parse(field.times[t]!);
    if (
      Number.isFinite(target) &&
      Number.isFinite(got) &&
      Math.abs(got - target) > maxDeltaMs
    ) {
      return null;
    }
  }
  const n = field.ncols * field.nrows;
  const start = t * n;
  return {
    west: field.west,
    south: field.south,
    east: field.east,
    north: field.north,
    dlon: field.dlon,
    dlat: field.dlat,
    ncols: field.ncols,
    nrows: field.nrows,
    time: field.times[t]!,
    speed: field.speed.subarray(start, start + n),
    dir: field.dir.subarray(start, start + n),
    uniform: false,
  };
}

export function uniformWindSlice(wind: WindHour): WindFieldSlice {
  const { ncols, nrows } = windFieldSize();
  const extent = windFieldExtent();
  const n = ncols * nrows;
  const speed = new Float32Array(n);
  const dir = new Float32Array(n);
  speed.fill(wind.windSpeedMps);
  dir.fill(wind.windDirDeg);
  return {
    ...extent,
    dlon: WIND_FIELD_STEP_LON,
    dlat: WIND_FIELD_STEP_LAT,
    ncols,
    nrows,
    time: wind.time,
    speed,
    dir,
    uniform: true,
  };
}

function finiteCell(
  slice: WindFieldSlice,
  i: number,
  j: number,
): { s: number; d: number } | null {
  if (i < 0 || j < 0 || i >= slice.ncols || j >= slice.nrows) return null;
  const idx = j * slice.ncols + i;
  const s = slice.speed[idx]!;
  const d = slice.dir[idx]!;
  if (!Number.isFinite(s) || !Number.isFinite(d)) return null;
  return { s, d };
}

function nearestFiniteCell(
  slice: WindFieldSlice,
  i: number,
  j: number,
): { s: number; d: number } | null {
  const hit = finiteCell(slice, i, j);
  if (hit) return hit;
  const { ncols, nrows } = slice;
  const maxR = Math.max(ncols, nrows);
  for (let r = 1; r <= maxR; r++) {
    for (let dj = -r; dj <= r; dj++) {
      const ii0 = i - r;
      const ii1 = i + r;
      const jj = j + dj;
      const a = finiteCell(slice, ii0, jj);
      if (a) return a;
      const b = finiteCell(slice, ii1, jj);
      if (b) return b;
    }
    for (let di = -r + 1; di <= r - 1; di++) {
      const ii = i + di;
      const a = finiteCell(slice, ii, j - r);
      if (a) return a;
      const b = finiteCell(slice, ii, j + r);
      if (b) return b;
    }
  }
  return null;
}

function averageWind(
  parts: Array<{ s: number; d: number; w: number }>,
): { speedMps: number; dirDeg: number } | null {
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
  if (wsum <= 0) return null;
  return {
    speedMps: s / wsum,
    dirDeg: ((Math.atan2(ux, uy) * 180) / Math.PI + 360) % 360,
  };
}

export function inWindFieldExtent(
  slice: WindFieldSlice,
  lon: number,
  lat: number,
): boolean {
  return (
    lon >= slice.west &&
    lon <= slice.east &&
    lat >= slice.south &&
    lat <= slice.north
  );
}

export function sampleWindField(
  slice: WindFieldSlice,
  lon: number,
  lat: number,
): { speedMps: number; dirDeg: number } | null {
  const { ncols, nrows, west, south, east, north } = slice;
  if (!inWindFieldExtent(slice, lon, lat)) return null;
  const fx = ((lon - west) / (east - west)) * ncols - 0.5;
  const fy = ((north - lat) / (north - south)) * nrows - 0.5;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  const tx = fx - i0;
  const ty = fy - j0;
  const parts: Array<{ s: number; d: number; w: number }> = [];
  const add = (ii: number, jj: number, w: number) => {
    const cell = finiteCell(slice, ii, jj);
    if (cell) parts.push({ ...cell, w });
  };
  add(i0, j0, (1 - tx) * (1 - ty));
  add(i0 + 1, j0, tx * (1 - ty));
  add(i0, j0 + 1, (1 - tx) * ty);
  add(i0 + 1, j0 + 1, tx * ty);
  const mixed = averageWind(parts);
  if (mixed) return mixed;
  const ic = Math.min(ncols - 1, Math.max(0, Math.round(fx)));
  const jc = Math.min(nrows - 1, Math.max(0, Math.round(fy)));
  const nearest = nearestFiniteCell(slice, ic, jc);
  return nearest ? { speedMps: nearest.s, dirDeg: nearest.d } : null;
}
