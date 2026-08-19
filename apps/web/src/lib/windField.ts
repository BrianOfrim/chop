import type { WindHour } from "./wind";

/**
 * Alberta 0.1° HRDPS grid (101×111). Keep in sync with apps/api/src/windGrid.ts.
 * Outside-Alberta cells stay empty (not filled with nearby wind).
 */
export const WIND_FIELD_WEST = -120;
export const WIND_FIELD_EAST = -110;
export const WIND_FIELD_SOUTH = 49;
export const WIND_FIELD_NORTH = 60;
export const WIND_FIELD_STEP_LAT = 0.1;
export const WIND_FIELD_STEP_LON = 0.1;
/** Nominal sample spacing (m) along latitude; lon spacing is smaller in the north. */
export const WIND_FIELD_STEP_M = WIND_FIELD_STEP_LAT * 110_574;
/** Alias for the latitude step. */
export const WIND_FIELD_STEP = WIND_FIELD_STEP_LAT;

const WIND_FIELD_NCOLS =
  Math.round((WIND_FIELD_EAST - WIND_FIELD_WEST) / WIND_FIELD_STEP_LON) + 1;
const WIND_FIELD_NROWS =
  Math.round((WIND_FIELD_NORTH - WIND_FIELD_SOUTH) / WIND_FIELD_STEP_LAT) + 1;

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
  return { ncols: WIND_FIELD_NCOLS, nrows: WIND_FIELD_NROWS };
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

type WindFieldJson = {
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
};

function unpack(arr: Array<number | null> | undefined): Float32Array {
  const out = new Float32Array(arr?.length ?? 0);
  if (!arr) return out;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    out[i] = v == null ? Number.NaN : v;
  }
  return out;
}

async function loadWindField(url: string): Promise<WindField> {
  const res = await globalThis.fetch(url);
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = `: ${body.error}`;
    } catch {
      // ignore
    }
    throw new Error(`Wind field error ${res.status}${detail}`);
  }
  const data = (await res.json()) as WindFieldJson;
  if (!Array.isArray(data.times) || data.times.length === 0) {
    throw new Error("Wind field returned no hours");
  }
  return {
    west: data.west,
    south: data.south,
    east: data.east,
    north: data.north,
    dlon: data.dlon,
    dlat: data.dlat,
    ncols: data.ncols,
    nrows: data.nrows,
    times: data.times,
    speed: unpack(data.speed),
    dir: unpack(data.dir),
  };
}

let forecastFieldPromise: Promise<WindField> | null = null;

export function fetchAlbertaWindField(): Promise<WindField> {
  if (!forecastFieldPromise) {
    forecastFieldPromise = loadWindField("/api/wind/field").catch((err) => {
      forecastFieldPromise = null;
      throw err;
    });
  }
  return forecastFieldPromise;
}

export function fetchAlbertaWindFieldRange(
  startDate: string,
  endDate: string,
): Promise<WindField> {
  const q = new URLSearchParams({ start: startDate, end: endDate });
  return loadWindField(`/api/wind/field?${q}`);
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

/** Match overlay to lake wind: HRDPS hours only; later GEM seamless stays as-is. */
export const HRDPS_HANDOFF_MS = 2 * 60 * 60 * 1000;

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
  mode: "blend" | "edges" = "blend",
): { speedMps: number; dirDeg: number } | null {
  const { ncols, nrows, west, south, east, north } = slice;
  if (!inWindFieldExtent(slice, lon, lat)) return null;
  if (mode === "edges") {
    const i = Math.min(
      ncols - 1,
      Math.max(0, Math.floor(((lon - west) / (east - west)) * ncols)),
    );
    const j = Math.min(
      nrows - 1,
      Math.max(0, Math.floor(((north - lat) / (north - south)) * nrows)),
    );
    const cell = finiteCell(slice, i, j);
    return cell ? { speedMps: cell.s, dirDeg: cell.d } : null;
  }
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

/** Replace speed/dir with HRDPS field samples when the hour is inside the HRDPS window. */
export function applyHrdpsFieldToHours(
  hours: WindHour[],
  field: WindField | null,
  lon: number,
  lat: number,
  maxDeltaMs: number = HRDPS_HANDOFF_MS,
): WindHour[] {
  if (!field || hours.length === 0) return hours;
  return hours.map((h) => {
    const slice = sliceWindField(field, h.time, maxDeltaMs);
    if (!slice) return h;
    const s = sampleWindField(slice, lon, lat);
    if (!s) return h;
    return {
      ...h,
      windSpeedMps: s.speedMps,
      windDirDeg: s.dirDeg,
    };
  });
}
