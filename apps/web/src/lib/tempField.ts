import type { WindHour } from "./wind";
import { HRDPS_HANDOFF_MS } from "./windField";

export type TempField = {
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
  temp: Float32Array;
};

export type TempFieldSlice = {
  west: number;
  south: number;
  east: number;
  north: number;
  dlon: number;
  dlat: number;
  ncols: number;
  nrows: number;
  time: string;
  temp: Float32Array;
};

type TempFieldJson = {
  west: number;
  south: number;
  east: number;
  north: number;
  dlon: number;
  dlat: number;
  ncols: number;
  nrows: number;
  times: string[];
  temp: Array<number | null>;
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

async function loadTempField(url: string): Promise<TempField> {
  const res = await globalThis.fetch(url);
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = `: ${body.error}`;
    } catch {
      // ignore
    }
    throw new Error(`Temp field error ${res.status}${detail}`);
  }
  const data = (await res.json()) as TempFieldJson;
  if (!Array.isArray(data.times) || data.times.length === 0) {
    throw new Error("Temp field returned no hours");
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
    temp: unpack(data.temp),
  };
}

let forecastTempPromise: Promise<TempField> | null = null;

export function fetchAlbertaTempField(): Promise<TempField> {
  if (!forecastTempPromise) {
    forecastTempPromise = loadTempField("/api/temp/field").catch((err) => {
      forecastTempPromise = null;
      throw err;
    });
  }
  return forecastTempPromise;
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

export function sliceTempField(
  field: TempField,
  timeIso: string,
  maxDeltaMs: number = HRDPS_HANDOFF_MS,
): TempFieldSlice | null {
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
    temp: field.temp.subarray(start, start + n),
  };
}

function finiteTemp(
  slice: TempFieldSlice,
  i: number,
  j: number,
): number | null {
  if (i < 0 || j < 0 || i >= slice.ncols || j >= slice.nrows) return null;
  const v = slice.temp[j * slice.ncols + i]!;
  return Number.isFinite(v) ? v : null;
}

/** Same cell index as Edges heatmap paint (no half-cell bilinear offset). */
function nearestTempIndex(
  slice: TempFieldSlice,
  lon: number,
  lat: number,
): { i: number; j: number } {
  const i = Math.min(
    slice.ncols - 1,
    Math.max(
      0,
      Math.floor(((lon - slice.west) / (slice.east - slice.west)) * slice.ncols),
    ),
  );
  const j = Math.min(
    slice.nrows - 1,
    Math.max(
      0,
      Math.floor(
        ((slice.north - lat) / (slice.north - slice.south)) * slice.nrows,
      ),
    ),
  );
  return { i, j };
}

export function sampleTempField(
  slice: TempFieldSlice,
  lon: number,
  lat: number,
  mode: "blend" | "edges" = "blend",
): number | null {
  if (
    lon < slice.west ||
    lon > slice.east ||
    lat < slice.south ||
    lat > slice.north
  ) {
    return null;
  }
  if (mode === "edges") {
    const { i, j } = nearestTempIndex(slice, lon, lat);
    return finiteTemp(slice, i, j);
  }
  const fx = ((lon - slice.west) / (slice.east - slice.west)) * slice.ncols - 0.5;
  const fy =
    ((slice.north - lat) / (slice.north - slice.south)) * slice.nrows - 0.5;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  const tx = fx - i0;
  const ty = fy - j0;
  const a = finiteTemp(slice, i0, j0);
  const b = finiteTemp(slice, i0 + 1, j0);
  const c = finiteTemp(slice, i0, j0 + 1);
  const d = finiteTemp(slice, i0 + 1, j0 + 1);
  const parts: Array<{ v: number; w: number }> = [];
  if (a != null) parts.push({ v: a, w: (1 - tx) * (1 - ty) });
  if (b != null) parts.push({ v: b, w: tx * (1 - ty) });
  if (c != null) parts.push({ v: c, w: (1 - tx) * ty });
  if (d != null) parts.push({ v: d, w: tx * ty });
  let wsum = 0;
  let s = 0;
  for (const p of parts) {
    if (p.w <= 0) continue;
    wsum += p.w;
    s += p.v * p.w;
  }
  if (wsum <= 0) return a;
  return s / wsum;
}

export function applyTempFieldToHours(
  hours: WindHour[],
  field: TempField | null,
  lon: number,
  lat: number,
  maxDeltaMs: number = HRDPS_HANDOFF_MS,
): WindHour[] {
  if (!field || hours.length === 0) return hours;
  return hours.map((h) => {
    const slice = sliceTempField(field, h.time, maxDeltaMs);
    if (!slice) return h;
    const tempC = sampleTempField(slice, lon, lat);
    if (tempC == null) return h;
    return { ...h, tempC };
  });
}
