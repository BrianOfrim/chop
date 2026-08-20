import { chopHs } from "./hs.js";

/** Half-width of the Saville / CEM effective-fetch sector (deg). */
export const FETCH_SECTOR_DEG = 45;

export type GridMeta = {
  ncols: number;
  nrows: number;
  /** West edge longitude (EPSG:4326). */
  west: number;
  /** South edge latitude (EPSG:4326). */
  south: number;
  /** East edge longitude. */
  east: number;
  /** North edge latitude. */
  north: number;
  cellSizeM: number;
  nodata: number;
  nDirs: number;
  /** Meteorological FROM directions (deg) for each fetch band. */
  directionsDeg: number[];
  waterSurfaceM?: number;
  contourIntervalM?: number;
  crs: string;
};

export type LakeGrids = {
  meta: GridMeta;
  /** Depth (m); nodata for land. Row-major, north row first (matching ASC). */
  depth: Float32Array;
  /**
   * Fetch lengths (m) packed as [dir0_allCells, dir1_allCells, ...].
   * Length = nDirs * ncols * nrows.
   */
  fetch: Float32Array;
  /** Compact per-direction max fetch; used for lake-max Hs without a full scan. */
  waveStats?: FetchDirStats | null;
};

/** Compact per-direction max-fetch summary for ranking lakes without full grids. */
export type FetchDirStats = {
  directionsDeg: number[];
  fetchMaxByDirM: number[];
  depthAtFetchMaxByDirM: number[];
};

/**
 * Lake-max Hs estimate from the per-direction fetch/depth summary, without
 * scanning the full grid. Stats pick the water cell that maximizes
 * depth-capped chop Hs at 10 m/s in each wind-direction bin.
 */
export function approxMaxHs(
  uMps: number,
  fromDeg: number,
  stats: FetchDirStats,
  durationSec?: number,
): number {
  const dirs = stats.directionsDeg;
  if (dirs.length === 0) return 0;
  const i = nearestDirIndex(fromDeg, dirs);
  const fetchM = stats.fetchMaxByDirM[i] ?? 0;
  const depthM = stats.depthAtFetchMaxByDirM[i] ?? 0;
  return chopHs(uMps, fetchM, depthM, durationSec);
}

/** Nearest fetch-direction index for a meteorological FROM bearing. */
export function nearestDirIndex(fromDeg: number, directionsDeg: number[]): number {
  const n = directionsDeg.length;
  let best = 0;
  let bestDiff = Infinity;
  const a = ((fromDeg % 360) + 360) % 360;
  for (let i = 0; i < n; i++) {
    const b = directionsDeg[i]!;
    let d = Math.abs(a - b) % 360;
    if (d > 180) d = 360 - d;
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

type FetchBlend = { i0: number; i1: number; w1: number };

/** Two nearest fetch bins and the weight on the second, for one wind direction. */
export function fetchDirBlend(meta: GridMeta, fromDeg: number): FetchBlend {
  const dirs = meta.directionsDeg;
  const n = dirs.length;
  const a = ((fromDeg % 360) + 360) % 360;
  let i0 = 0;
  let i1 = n > 1 ? 1 : 0;
  let d0 = Infinity;
  let d1 = Infinity;
  for (let i = 0; i < n; i++) {
    let d = Math.abs(a - dirs[i]!) % 360;
    if (d > 180) d = 360 - d;
    if (d < d0) {
      d1 = d0;
      i1 = i0;
      d0 = d;
      i0 = i;
    } else if (d < d1) {
      d1 = d;
      i1 = i;
    }
  }
  if (!(d0 + d1 > 0)) return { i0, i1, w1: 0 };
  return { i0, i1, w1: d0 / (d0 + d1) };
}

export type FetchWeights = { idxs: number[]; weights: number[] };

/**
 * Cosine-squared effective fetch weights over bins within ±FETCH_SECTOR_DEG
 * of the wind (Saville / CEM-style). Falls back to two-nearest blend.
 */
export function effectiveFetchWeights(
  meta: GridMeta,
  fromDeg: number,
): FetchWeights {
  const dirs = meta.directionsDeg;
  const a = ((fromDeg % 360) + 360) % 360;
  const idxs: number[] = [];
  const raw: number[] = [];
  for (let i = 0; i < dirs.length; i++) {
    let d = Math.abs(a - dirs[i]!) % 360;
    if (d > 180) d = 360 - d;
    if (d > FETCH_SECTOR_DEG + 1e-6) continue;
    const w = Math.cos((d * Math.PI) / 180) ** 2;
    if (!(w > 0)) continue;
    idxs.push(i);
    raw.push(w);
  }
  if (idxs.length === 0) {
    const { i0, i1, w1 } = fetchDirBlend(meta, fromDeg);
    if (i0 === i1) return { idxs: [i0], weights: [1] };
    return { idxs: [i0, i1], weights: [1 - w1, w1] };
  }
  let sum = 0;
  for (const w of raw) sum += w;
  return { idxs, weights: raw.map((w) => w / sum) };
}

function fetchWeighted(
  fetch: Float32Array,
  n: number,
  cellIndex: number,
  idxs: number[],
  weights: number[],
): number {
  let f = 0;
  for (let k = 0; k < idxs.length; k++) {
    f += fetch[idxs[k]! * n + cellIndex]! * weights[k]!;
  }
  return f;
}

/**
 * Effective fetch at a cell for a meteorological FROM bearing.
 */
export function fetchAtDir(
  fetch: Float32Array,
  meta: GridMeta,
  cellIndex: number,
  fromDeg: number,
): number {
  const { idxs, weights } = effectiveFetchWeights(meta, fromDeg);
  return fetchWeighted(fetch, meta.ncols * meta.nrows, cellIndex, idxs, weights);
}

/** Compute Hs (m) for every water cell; land stays NaN. */
export function computeHsGrid(
  grids: LakeGrids,
  uMps: number,
  fromDeg: number,
  durationSec?: number,
): Float32Array {
  const { meta, depth, fetch } = grids;
  const n = meta.ncols * meta.nrows;
  const out = new Float32Array(n);
  const nodata = meta.nodata;
  const { idxs, weights } = effectiveFetchWeights(meta, fromDeg);
  for (let i = 0; i < n; i++) {
    const d = depth[i]!;
    if (!Number.isFinite(d) || d === nodata || d <= 0) {
      out[i] = Number.NaN;
      continue;
    }
    const f = fetchWeighted(fetch, n, i, idxs, weights);
    out[i] = chopHs(uMps, f, d, durationSec);
  }
  return out;
}

/** Coarse spatial wind (HRDPS-style). Matches apps/web WindFieldSlice layout. */
export type SpatialWindGrid = {
  west: number;
  south: number;
  east: number;
  north: number;
  ncols: number;
  nrows: number;
  speed: Float32Array;
  dir: Float32Array;
  /** True when every cell is the same vector (sim / uniform fallback). */
  uniform?: boolean;
};

export type LonLatBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

function inSpatialWindExtent(
  wind: SpatialWindGrid,
  lon: number,
  lat: number,
): boolean {
  return (
    lon >= wind.west &&
    lon <= wind.east &&
    lat >= wind.south &&
    lat <= wind.north
  );
}

/** Nearest wind-grid cell, same indexing as sampleWindField(..., "edges"). */
export function spatialWindCellIndex(
  wind: SpatialWindGrid,
  lon: number,
  lat: number,
): number | null {
  if (!inSpatialWindExtent(wind, lon, lat)) return null;
  const { ncols, nrows, west, south, east, north } = wind;
  const i = Math.min(
    ncols - 1,
    Math.max(0, Math.floor(((lon - west) / (east - west)) * ncols)),
  );
  const j = Math.min(
    nrows - 1,
    Math.max(0, Math.floor(((north - lat) / (north - south)) * nrows)),
  );
  return j * ncols + i;
}

function fillHsForWindGroup(
  grids: LakeGrids,
  out: Float32Array,
  cellIdxs: number[],
  uMps: number,
  fromDeg: number,
  durationSec?: number,
): void {
  const { meta, depth, fetch } = grids;
  const n = meta.ncols * meta.nrows;
  const { idxs, weights } = effectiveFetchWeights(meta, fromDeg);
  for (const idx of cellIdxs) {
    const d = depth[idx]!;
    const f = fetchWeighted(fetch, n, idx, idxs, weights);
    out[idx] = chopHs(uMps, f, d, durationSec);
  }
}

/**
 * Hs from local spatial wind + per-cell fetch.
 * Groups lake cells by wind-grid index so fetch-direction blend runs once per
 * ~11 km HRDPS cell. Uniform slices fall back to computeHsGrid.
 */
export function computeHsGridFromWind(
  grids: LakeGrids,
  wind: SpatialWindGrid,
  durationSec?: number,
): Float32Array {
  if (wind.uniform) {
    const u = wind.speed[0];
    const dir = wind.dir[0];
    if (u != null && dir != null && Number.isFinite(u) && Number.isFinite(dir)) {
      return computeHsGrid(grids, u, dir, durationSec);
    }
  }
  const { meta, depth } = grids;
  const n = meta.ncols * meta.nrows;
  const out = new Float32Array(n);
  const nodata = meta.nodata;
  const lon0 = meta.west;
  const lat0 = meta.north;
  const dlon = (meta.east - meta.west) / meta.ncols;
  const dlat = (meta.north - meta.south) / meta.nrows;
  const groups = new Map<number, { u: number; dir: number; idxs: number[] }>();

  for (let j = 0; j < meta.nrows; j++) {
    const lat = lat0 - (j + 0.5) * dlat;
    for (let i = 0; i < meta.ncols; i++) {
      const idx = j * meta.ncols + i;
      const d = depth[idx]!;
      if (!Number.isFinite(d) || d === nodata || d <= 0) {
        out[idx] = Number.NaN;
        continue;
      }
      const lon = lon0 + (i + 0.5) * dlon;
      const widx = spatialWindCellIndex(wind, lon, lat);
      if (widx == null) {
        out[idx] = Number.NaN;
        continue;
      }
      let g = groups.get(widx);
      if (!g) {
        const u = wind.speed[widx]!;
        const dir = wind.dir[widx]!;
        if (!Number.isFinite(u) || !Number.isFinite(dir)) {
          out[idx] = Number.NaN;
          continue;
        }
        g = { u, dir, idxs: [] };
        groups.set(widx, g);
      }
      g.idxs.push(idx);
    }
  }

  for (const g of groups.values()) {
    fillHsForWindGroup(grids, out, g.idxs, g.u, g.dir, durationSec);
  }
  return out;
}

/** Max approx Hs over wind-grid cells that overlap a lake bounding box. */
export function approxMaxHsOverWind(
  stats: FetchDirStats,
  wind: SpatialWindGrid,
  bbox: LonLatBounds,
  durationSec?: number,
): number {
  if (wind.uniform) {
    const u = wind.speed[0];
    const dir = wind.dir[0];
    if (u == null || dir == null || !Number.isFinite(u) || !Number.isFinite(dir)) {
      return 0;
    }
    return approxMaxHs(u, dir, stats, durationSec);
  }
  const a = spatialWindCellIndex(wind, bbox.west, bbox.south);
  const b = spatialWindCellIndex(wind, bbox.east, bbox.north);
  const c = spatialWindCellIndex(wind, bbox.west, bbox.north);
  const d = spatialWindCellIndex(wind, bbox.east, bbox.south);
  const hits = [a, b, c, d].filter((x): x is number => x != null);
  if (hits.length === 0) return 0;
  const { ncols } = wind;
  let i0 = ncols;
  let i1 = 0;
  let j0 = wind.nrows;
  let j1 = 0;
  for (const idx of hits) {
    const i = idx % ncols;
    const j = Math.floor(idx / ncols);
    i0 = Math.min(i0, i);
    i1 = Math.max(i1, i);
    j0 = Math.min(j0, j);
    j1 = Math.max(j1, j);
  }
  let max = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const idx = j * ncols + i;
      const u = wind.speed[idx]!;
      const dir = wind.dir[idx]!;
      if (!Number.isFinite(u) || !Number.isFinite(dir)) continue;
      const hs = approxMaxHs(u, dir, stats, durationSec);
      if (hs > max) max = hs;
    }
  }
  return max;
}

/** Water-cell index nearest to lon/lat, or null if off-grid / all land. */
export function nearestWaterCellIndex(
  values: Float32Array,
  meta: GridMeta,
  lon: number,
  lat: number,
): number | null {
  const { ncols, nrows, west, south, east, north } = meta;
  if (lon < west || lon > east || lat < south || lat > north) return null;
  const i0 = Math.min(
    ncols - 1,
    Math.max(0, Math.floor(((lon - west) / (east - west)) * ncols)),
  );
  const j0 = Math.min(
    nrows - 1,
    Math.max(0, Math.floor(((north - lat) / (north - south)) * nrows)),
  );
  const at = (i: number, j: number) => j * ncols + i;
  const v0 = values[at(i0, j0)]!;
  if (Number.isFinite(v0) && v0 >= 0) return at(i0, j0);
  for (let r = 1; r <= 4; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di;
        const j = j0 + dj;
        if (i < 0 || j < 0 || i >= ncols || j >= nrows) continue;
        const idx = at(i, j);
        const val = values[idx]!;
        if (Number.isFinite(val) && val >= 0) return idx;
      }
    }
  }
  return null;
}

/** Hs at one water cell; null if the point is off-water. */
export function hsAtLonLat(
  grids: LakeGrids,
  lon: number,
  lat: number,
  uMps: number,
  fromDeg: number,
  durationSec?: number,
): number | null {
  const i = nearestWaterCellIndex(grids.depth, grids.meta, lon, lat);
  if (i == null) return null;
  const d = grids.depth[i]!;
  if (!(d > 0)) return null;
  const f = fetchAtDir(grids.fetch, grids.meta, i, fromDeg);
  return chopHs(uMps, f, d, durationSec);
}

/** Sample grid value at lon/lat (bilinear for depth/Hs; returns null off-grid / land). */
export function sampleGrid(
  values: Float32Array,
  meta: GridMeta,
  lon: number,
  lat: number,
): number | null {
  const { ncols, nrows, west, south, east, north } = meta;
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
  const v = (ii: number, jj: number) => values[jj * ncols + ii]!;
  const a = v(i0, j0);
  const b = v(i1, j0);
  const c = v(i0, j1);
  const d = v(i1, j1);
  if (![a, b, c, d].every((x) => Number.isFinite(x))) return null;
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

/** Bilinear sample, then nearest finite water cell within a few cells (near-shore). */
export function sampleGridNearestWater(
  values: Float32Array,
  meta: GridMeta,
  lon: number,
  lat: number,
): number | null {
  const bilinear = sampleGrid(values, meta, lon, lat);
  if (bilinear != null) return bilinear;
  const { ncols, nrows, west, south, east, north } = meta;
  if (lon < west || lon > east || lat < south || lat > north) return null;
  const i0 = Math.min(
    ncols - 1,
    Math.max(0, Math.floor(((lon - west) / (east - west)) * ncols)),
  );
  const j0 = Math.min(
    nrows - 1,
    Math.max(0, Math.floor(((north - lat) / (north - south)) * nrows)),
  );
  for (let r = 0; r <= 4; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di;
        const j = j0 + dj;
        if (i < 0 || j < 0 || i >= ncols || j >= nrows) continue;
        const val = values[j * ncols + i]!;
        if (Number.isFinite(val) && val >= 0) return val;
      }
    }
  }
  return null;
}
