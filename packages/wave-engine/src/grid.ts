import { smbHsDepthLimited } from "./smb.js";

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
};

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

/**
 * Blend fetch from the two nearest direction bins by angular weight.
 */
export function fetchAtDir(
  fetch: Float32Array,
  meta: GridMeta,
  cellIndex: number,
  fromDeg: number,
): number {
  const dirs = meta.directionsDeg;
  const n = dirs.length;
  const a = ((fromDeg % 360) + 360) % 360;
  let i0 = 0;
  let i1 = 1;
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
  const cells = meta.ncols * meta.nrows;
  const f0 = fetch[i0 * cells + cellIndex]!;
  const f1 = fetch[i1 * cells + cellIndex]!;
  if (!(d0 + d1 > 0)) return f0;
  const w1 = d0 / (d0 + d1);
  return f0 * (1 - w1) + f1 * w1;
}

/** Compute Hs (m) for every water cell; land stays NaN. */
export function computeHsGrid(
  grids: LakeGrids,
  uMps: number,
  fromDeg: number,
): Float32Array {
  const { meta, depth, fetch } = grids;
  const n = meta.ncols * meta.nrows;
  const out = new Float32Array(n);
  const nodata = meta.nodata;
  for (let i = 0; i < n; i++) {
    const d = depth[i]!;
    if (!Number.isFinite(d) || d === nodata || d <= 0) {
      out[i] = Number.NaN;
      continue;
    }
    const f = fetchAtDir(fetch, meta, i, fromDeg);
    out[i] = smbHsDepthLimited(uMps, f, d);
  }
  return out;
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
