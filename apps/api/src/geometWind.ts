/**
 * Provincial 10 m wind from MSC GeoMet HRDPS (one raster per hour, not
 * hundreds of Open-Meteo point calls).
 */
import { fromArrayBuffer } from "geotiff";
import {
  NCOLS,
  NROWS,
  cellLat,
  cellLon,
  fieldExtent,
  STEP_LAT,
  STEP_LON,
} from "./windGrid.ts";
import type { TempFieldJson, WindFieldJson } from "./wind.ts";

const GEOMET = "https://geo.weather.gc.ca/geomet";
const CONCURRENCY = 4;
const UA = "chop-lake-app/1.0";

type GemModel = {
  name: "hrdps" | "rdps" | "gdps";
  wspd: string;
  wdir: string;
};

/** Highest-res first. Later models only fill hours the earlier ones don’t have. */
const GEM_MODELS: GemModel[] = [
  {
    name: "hrdps",
    wspd: "HRDPS.CONTINENTAL_WSPD",
    wdir: "HRDPS.CONTINENTAL_WD",
  },
  {
    name: "rdps",
    wspd: "RDPS_10km_WindSpeed_10m",
    wdir: "RDPS_10km_WindDir_10m",
  },
  {
    name: "gdps",
    wspd: "GDPS_15km_WindSpeed_10m",
    wdir: "GDPS_15km_WindDir_10m",
  },
];

type Raster = {
  west: number;
  south: number;
  east: number;
  north: number;
  width: number;
  height: number;
  values: Float32Array;
};

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}

function parseTimeDimension(spec: string): string[] {
  const trimmed = spec.trim();
  if (trimmed.includes(",")) {
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const parts = trimmed.split("/");
  if (parts.length !== 3) return trimmed ? [trimmed] : [];
  const start = Date.parse(parts[0]!);
  const end = Date.parse(parts[1]!);
  const stepMatch = /^PT(\d+)H$/.exec(parts[2]!);
  const stepH = stepMatch ? Number(stepMatch[1]) : Number.NaN;
  const step = stepH * 3600_000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step)) {
    return [];
  }
  const out: string[] = [];
  for (let t = start; t <= end + 1; t += step) {
    out.push(new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"));
  }
  return out;
}

function toEdmontonHour(isoUtc: string): string {
  const d = new Date(isoUtc);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const g = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GeoMet ${res.status}`);
  return res.text();
}

async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await delay(800 * 2 ** (attempt - 1));
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`GeoMet ${res.status}`);
      continue;
    }
    if (!res.ok) throw new Error(`GeoMet ${res.status}`);
    const buf = await res.arrayBuffer();
    const head = new Uint8Array(buf, 0, Math.min(buf.byteLength, 20));
    const looksXml = head[0] === 0x3c;
    if (looksXml) {
      const text = new TextDecoder().decode(buf.slice(0, 400));
      lastErr = new Error(
        `GeoMet returned XML instead of GeoTIFF: ${text.replace(/\s+/g, " ").slice(0, 180)}`,
      );
      continue;
    }
    return buf;
  }
  throw lastErr ?? new Error("GeoMet fetch failed");
}

async function modelTimeRange(coverageId: string): Promise<string[]> {
  const url = `${GEOMET}?service=WMS&version=1.3.0&request=GetCapabilities&layer=${coverageId}`;
  const xml = await fetchText(url);
  const m = xml.match(
    /<Dimension name="time"[^>]*>([^<]+)<\/Dimension>/,
  );
  if (!m?.[1]) throw new Error(`GeoMet ${coverageId} time dimension missing`);
  const times = parseTimeDimension(m[1]);
  if (times.length === 0) throw new Error(`GeoMet ${coverageId} time range empty`);
  return times;
}

function coverageUrl(
  coverageId: string,
  timeIso: string,
): string {
  const q = new URLSearchParams({
    SERVICE: "WCS",
    VERSION: "2.0.1",
    REQUEST: "GetCoverage",
    COVERAGEID: coverageId,
    FORMAT: "image/tiff",
    SUBSETTINGCRS: "EPSG:4326",
    OUTPUTCRS: "EPSG:4326",
  });
  return (
    `${GEOMET}?${q}` +
    `&TIME=${timeIso}` +
    `&SCALESIZE=x(${NCOLS}),y(${NROWS})` +
    `&SUBSET=x(-120,-110)&SUBSET=y(49,60)`
  );
}

async function readRaster(buf: ArrayBuffer): Promise<Raster> {
  const tiff = await fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const bbox = image.getBoundingBox();
  const rasters = await image.readRasters({ interleave: false });
  const band = Array.isArray(rasters) ? rasters[0] : rasters;
  if (!band || typeof band === "number") {
    throw new Error("GeoMet GeoTIFF missing band");
  }
  const values = new Float32Array(band.length);
  for (let i = 0; i < band.length; i++) values[i] = Number(band[i]);
  return {
    west: bbox[0],
    south: bbox[1],
    east: bbox[2],
    north: bbox[3],
    width: image.getWidth(),
    height: image.getHeight(),
    values,
  };
}

function sampleRaster(
  raster: Raster,
  lon: number,
  lat: number,
  valid: (v: number) => boolean,
): number {
  const { west, south, east, north, width, height, values } = raster;
  if (east === west || north === south) return Number.NaN;
  const fx = ((lon - west) / (east - west)) * width - 0.5;
  const fy = ((north - lat) / (north - south)) * height - 0.5;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  const tx = fx - i0;
  const ty = fy - j0;
  const at = (i: number, j: number): number => {
    if (i < 0 || j < 0 || i >= width || j >= height) return Number.NaN;
    const v = values[j * width + i]!;
    return Number.isFinite(v) && valid(v) ? v : Number.NaN;
  };
  const a = at(i0, j0);
  const b = at(i0 + 1, j0);
  const c = at(i0, j0 + 1);
  const d = at(i0 + 1, j0 + 1);
  const parts: Array<{ v: number; w: number }> = [];
  if (Number.isFinite(a)) parts.push({ v: a, w: (1 - tx) * (1 - ty) });
  if (Number.isFinite(b)) parts.push({ v: b, w: tx * (1 - ty) });
  if (Number.isFinite(c)) parts.push({ v: c, w: (1 - tx) * ty });
  if (Number.isFinite(d)) parts.push({ v: d, w: tx * ty });
  let wsum = 0;
  let vsum = 0;
  for (const p of parts) {
    wsum += p.w;
    vsum += p.v * p.w;
  }
  return wsum > 0 ? vsum / wsum : Number.NaN;
}

function isWindSample(v: number): boolean {
  return v > -50 && v < 400;
}

function isTempC(v: number): boolean {
  return v > -80 && v < 60;
}

async function fetchHourRasters(
  model: GemModel,
  timeIso: string,
): Promise<{
  speed: Raster;
  dir: Raster;
}> {
  const [speedBuf, dirBuf] = await Promise.all([
    fetchBuffer(coverageUrl(model.wspd, timeIso)),
    fetchBuffer(coverageUrl(model.wdir, timeIso)),
  ]);
  const [speed, dir] = await Promise.all([
    readRaster(speedBuf),
    readRaster(dirBuf),
  ]);
  return { speed, dir };
}

function writeHour(
  speed: Array<number | null>,
  dir: Array<number | null>,
  t: number,
  rasters: { speed: Raster; dir: Raster },
): void {
  const ncells = NCOLS * NROWS;
  for (let j = 0; j < NROWS; j++) {
    for (let i = 0; i < NCOLS; i++) {
      const lon = cellLon(i);
      const lat = cellLat(j);
      const s = sampleRaster(rasters.speed, lon, lat, isWindSample);
      const d = sampleRaster(rasters.dir, lon, lat, isWindSample);
      if (!Number.isFinite(s) || !Number.isFinite(d) || s < 0) continue;
      const idx = t * ncells + j * NCOLS + i;
      speed[idx] = s;
      dir[idx] = ((d % 360) + 360) % 360;
    }
  }
}

export async function fetchGeometForecastField(): Promise<WindFieldJson> {
  const ncells = NCOLS * NROWS;
  const byHour = new Map<
    string,
    { utc: string; speed: Array<number | null>; dir: Array<number | null> }
  >();

  for (const model of GEM_MODELS) {
    const utcTimes = await modelTimeRange(model.wspd);
    const need = utcTimes.filter((utc) => !byHour.has(toEdmontonHour(utc)));
    if (need.length === 0) continue;
    console.log(
      `wind field GeoMet ${model.name} ${need.length} new hours (${utcTimes.length} available)`,
    );
    await mapPool(
      need.map((utc, i) => ({ utc, i })),
      CONCURRENCY,
      async ({ utc, i }) => {
        const rasters = await fetchHourRasters(model, utc);
        const hourSpeed: Array<number | null> = Array.from(
          { length: ncells },
          () => null,
        );
        const hourDir: Array<number | null> = Array.from(
          { length: ncells },
          () => null,
        );
        writeHour(hourSpeed, hourDir, 0, rasters);
        const key = toEdmontonHour(utc);
        byHour.set(key, { utc, speed: hourSpeed, dir: hourDir });
        console.log(
          `wind field GeoMet ${model.name} ${i + 1}/${need.length} ${utc}`,
        );
      },
    );
  }

  const ordered = [...byHour.entries()].sort(
    (a, b) => Date.parse(a[1].utc) - Date.parse(b[1].utc),
  );
  if (ordered.length === 0) throw new Error("GeoMet wind field empty");
  const times = ordered.map(([key]) => key);
  const speed: Array<number | null> = Array.from(
    { length: times.length * ncells },
    () => null,
  );
  const dir: Array<number | null> = Array.from(
    { length: times.length * ncells },
    () => null,
  );
  for (let t = 0; t < ordered.length; t++) {
    const hour = ordered[t]![1];
    const off = t * ncells;
    for (let k = 0; k < ncells; k++) {
      speed[off + k] = hour.speed[k]!;
      dir[off + k] = hour.dir[k]!;
    }
  }
  console.log(`wind field GeoMet merged ${times.length} hours ${NCOLS}×${NROWS}`);
  return {
    ...fieldExtent(),
    dlon: STEP_LON,
    dlat: STEP_LAT,
    ncols: NCOLS,
    nrows: NROWS,
    times,
    speed,
    dir,
    fetchedAt: new Date().toISOString(),
    source: "geomet-gem",
    kind: "forecast",
  };
}

type TempModel = { name: "hrdps" | "rdps" | "gdps"; id: string };

const TEMP_MODELS: TempModel[] = [
  { name: "hrdps", id: "HRDPS.CONTINENTAL_TT" },
  { name: "rdps", id: "RDPS_10km_AirTemp_2m" },
  { name: "gdps", id: "GDPS_15km_AirTemp_2m" },
];

function writeTempHour(
  temp: Array<number | null>,
  raster: Raster,
): void {
  for (let j = 0; j < NROWS; j++) {
    for (let i = 0; i < NCOLS; i++) {
      const lon = cellLon(i);
      const lat = cellLat(j);
      const v = sampleRaster(raster, lon, lat, isTempC);
      if (!Number.isFinite(v)) continue;
      temp[j * NCOLS + i] = v;
    }
  }
}

export async function fetchGeometTempField(): Promise<TempFieldJson> {
  const ncells = NCOLS * NROWS;
  const byHour = new Map<
    string,
    { utc: string; temp: Array<number | null> }
  >();

  for (const model of TEMP_MODELS) {
    const utcTimes = await modelTimeRange(model.id);
    const need = utcTimes.filter((utc) => !byHour.has(toEdmontonHour(utc)));
    if (need.length === 0) continue;
    console.log(
      `temp field GeoMet ${model.name} ${need.length} new hours (${utcTimes.length} available)`,
    );
    await mapPool(
      need.map((utc, i) => ({ utc, i })),
      CONCURRENCY,
      async ({ utc, i }) => {
        const raster = await readRaster(await fetchBuffer(coverageUrl(model.id, utc)));
        const hourTemp: Array<number | null> = Array.from(
          { length: ncells },
          () => null,
        );
        writeTempHour(hourTemp, raster);
        const key = toEdmontonHour(utc);
        byHour.set(key, { utc, temp: hourTemp });
        console.log(
          `temp field GeoMet ${model.name} ${i + 1}/${need.length} ${utc}`,
        );
      },
    );
  }

  const ordered = [...byHour.entries()].sort(
    (a, b) => Date.parse(a[1].utc) - Date.parse(b[1].utc),
  );
  if (ordered.length === 0) throw new Error("GeoMet temp field empty");
  const times = ordered.map(([key]) => key);
  const temp: Array<number | null> = Array.from(
    { length: times.length * ncells },
    () => null,
  );
  for (let t = 0; t < ordered.length; t++) {
    const hour = ordered[t]![1];
    const off = t * ncells;
    for (let k = 0; k < ncells; k++) {
      temp[off + k] = hour.temp[k]!;
    }
  }
  console.log(`temp field GeoMet merged ${times.length} hours ${NCOLS}×${NROWS}`);
  return {
    ...fieldExtent(),
    dlon: STEP_LON,
    dlat: STEP_LAT,
    ncols: NCOLS,
    nrows: NROWS,
    times,
    temp,
    fetchedAt: new Date().toISOString(),
    source: "geomet-gem",
    kind: "forecast",
  };
}
