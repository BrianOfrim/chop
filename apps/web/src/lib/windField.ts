import type { WindHour } from "./wind";

/** ~0.5° (~45–55 km) GEM/HRDPS samples covering Alberta. */
export const WIND_FIELD_WEST = -120;
export const WIND_FIELD_EAST = -110;
export const WIND_FIELD_SOUTH = 49;
export const WIND_FIELD_NORTH = 60;
export const WIND_FIELD_STEP = 0.5;

const FORECAST_URL = "https://api.open-meteo.com/v1/gem";
const HISTORICAL_URL =
  "https://historical-forecast-api.open-meteo.com/v1/forecast";
/** Open-Meteo allows up to 1000 locations in one POST. Alberta 0.5° is 483. */
const MAX_LOCATIONS = 1000;

type GemHourly = {
  latitude?: number;
  longitude?: number;
  hourly?: {
    time?: string[];
    wind_speed_10m?: Array<number | null>;
    wind_direction_10m?: Array<number | null>;
  };
};

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
};

export function windFieldSize(): { ncols: number; nrows: number } {
  const ncols =
    Math.round((WIND_FIELD_EAST - WIND_FIELD_WEST) / WIND_FIELD_STEP) + 1;
  const nrows =
    Math.round((WIND_FIELD_NORTH - WIND_FIELD_SOUTH) / WIND_FIELD_STEP) + 1;
  return { ncols, nrows };
}

export function windFieldExtent(): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  const half = WIND_FIELD_STEP / 2;
  return {
    west: WIND_FIELD_WEST - half,
    east: WIND_FIELD_EAST + half,
    south: WIND_FIELD_SOUTH - half,
    north: WIND_FIELD_NORTH + half,
  };
}

export function windGridLon(i: number): number {
  return WIND_FIELD_WEST + i * WIND_FIELD_STEP;
}

export function windGridLat(j: number): number {
  return WIND_FIELD_NORTH - j * WIND_FIELD_STEP;
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
  const body: Record<string, unknown> = {
    latitude: pts.map((p) => Number(p.lat.toFixed(3))),
    longitude: pts.map((p) => Number(p.lon.toFixed(3))),
    hourly: ["wind_speed_10m", "wind_direction_10m"],
    wind_speed_unit: "ms",
    timezone: "America/Edmonton",
  };
  if (kind === "history" && startDate && endDate) {
    body.start_date = startDate;
    body.end_date = endDate;
    body.models = "gem_hrdps_continental";
  } else {
    body.forecast_days = 7;
    body.past_days = 1;
    body.models = "gem_seamless";
  }
  return body;
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
  const url = kind === "history" ? HISTORICAL_URL : FORECAST_URL;
  const body = JSON.stringify(fieldRequestBody(kind, pts, startDate, endDate));
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 800 * 2 ** (attempt - 1)));
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

async function fetchAlbertaWindFieldWith(
  kind: "forecast" | "history",
  startDate?: string,
  endDate?: string,
): Promise<WindField> {
  const pts = points();
  const { ncols, nrows } = windFieldSize();
  const ncells = ncols * nrows;
  const rows = await fetchLocations(kind, pts, startDate, endDate);

  const times = rows[0]?.hourly?.time ?? [];
  if (times.length === 0) throw new Error("Wind field returned no hours");
  const speed = new Float32Array(times.length * ncells);
  const dir = new Float32Array(times.length * ncells);
  speed.fill(Number.NaN);
  dir.fill(Number.NaN);

  for (let p = 0; p < pts.length; p++) {
    const cell = pts[p]!;
    const hourly = rows[p]?.hourly;
    const spd = hourly?.wind_speed_10m ?? [];
    const deg = hourly?.wind_direction_10m ?? [];
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
    dlon: WIND_FIELD_STEP,
    dlat: WIND_FIELD_STEP,
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
    dlon: WIND_FIELD_STEP,
    dlat: WIND_FIELD_STEP,
    ncols,
    nrows,
    time: wind.time,
    speed,
    dir,
  };
}

export function sampleWindField(
  slice: WindFieldSlice,
  lon: number,
  lat: number,
): { speedMps: number; dirDeg: number } | null {
  const { ncols, nrows, west, south, east, north, speed, dir } = slice;
  if (lon < west || lon > east || lat < south || lat > north) return null;
  const fx = ((lon - west) / (east - west)) * ncols - 0.5;
  const fy = ((north - lat) / (north - south)) * nrows - 0.5;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  const i1 = i0 + 1;
  const j1 = j0 + 1;
  if (i0 < 0 || j0 < 0 || i1 >= ncols || j1 >= nrows) return null;
  const tx = fx - i0;
  const ty = fy - j0;
  const at = (ii: number, jj: number) => {
    const idx = jj * ncols + ii;
    return { s: speed[idx]!, d: dir[idx]! };
  };
  const a = at(i0, j0);
  const b = at(i1, j0);
  const c = at(i0, j1);
  const d = at(i1, j1);
  if (![a, b, c, d].every((x) => Number.isFinite(x.s) && Number.isFinite(x.d))) {
    return null;
  }
  const s =
    a.s * (1 - tx) * (1 - ty) +
    b.s * tx * (1 - ty) +
    c.s * (1 - tx) * ty +
    d.s * tx * ty;
  // Direction via unit-vector average so 350°/10° interpolates correctly.
  let ux = 0;
  let uy = 0;
  const add = (deg: number, w: number) => {
    const r = (deg * Math.PI) / 180;
    ux += Math.sin(r) * w;
    uy += Math.cos(r) * w;
  };
  add(a.d, (1 - tx) * (1 - ty));
  add(b.d, tx * (1 - ty));
  add(c.d, (1 - tx) * ty);
  add(d.d, tx * ty);
  const dirDeg = ((Math.atan2(ux, uy) * 180) / Math.PI + 360) % 360;
  return { speedMps: s, dirDeg };
}
