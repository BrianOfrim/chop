import type { FetchDirStats, GridMeta, LakeGrids } from "@chop/wave-engine";

export type SpotProfile = {
  spotId: string;
  identity: {
    name: string;
    latitude: number;
    longitude: number;
    timezone: string;
    summary?: string;
  };
  proxyPoints: Array<{
    id: string;
    role: string;
    latitude: number;
    longitude: number;
  }>;
  ridePoints?: Array<{
    id: string;
    name: string;
    latitude: number;
    longitude: number;
  }>;
};

export type LakeIndexEntry = {
  id: string;
  name: string;
  region: string;
  enabled: boolean;
  path: string;
};

export function proxyLatLon(spot: SpotProfile): { lat: number; lon: number } {
  const proxy =
    spot.proxyPoints.find(
      (p) =>
        p.role === "background_model_point" ||
        p.role === "open_water_model_point",
    ) ?? spot.proxyPoints[0];
  return {
    lat: proxy?.latitude ?? spot.identity.latitude,
    lon: proxy?.longitude ?? spot.identity.longitude,
  };
}

type GridJson = GridMeta & {
  stats?: {
    fetchMaxByDirM?: number[];
    depthAtFetchMaxByDirM?: number[];
  };
};

export function waveStatsFromGrid(grid: GridJson): FetchDirStats | null {
  const fetchMax = grid.stats?.fetchMaxByDirM;
  const depths = grid.stats?.depthAtFetchMaxByDirM;
  const dirs = grid.directionsDeg;
  if (
    !Array.isArray(fetchMax) ||
    !Array.isArray(depths) ||
    !Array.isArray(dirs) ||
    fetchMax.length !== dirs.length ||
    depths.length !== dirs.length
  ) {
    return null;
  }
  return {
    directionsDeg: dirs,
    fetchMaxByDirM: fetchMax.map(Number),
    depthAtFetchMaxByDirM: depths.map(Number),
  };
}

export async function loadLakeCompareAssets(basePath: string): Promise<{
  spot: SpotProfile;
  waveStats: FetchDirStats | null;
}> {
  const [spotRes, gridRes] = await Promise.all([
    globalThis.fetch(`${basePath}/spot-profile.json`),
    globalThis.fetch(`${basePath}/grid.json`),
  ]);
  if (!spotRes.ok) {
    throw new Error(`Failed to load spot profile from ${basePath}`);
  }
  const spot = (await spotRes.json()) as SpotProfile;
  if (!gridRes.ok) {
    return { spot, waveStats: null };
  }
  const grid = (await gridRes.json()) as GridJson;
  return { spot, waveStats: waveStatsFromGrid(grid) };
}

export async function loadLakeIndex(): Promise<LakeIndexEntry[]> {
  const res = await globalThis.fetch("/lakes/index.json");
  if (!res.ok) throw new Error("Failed to load lakes index");
  const data = (await res.json()) as { lakes: LakeIndexEntry[] };
  return data.lakes;
}

/** Shorelines for every enabled lake, tagged with `lakeId` / `name`. */
export async function loadAllLakeShorelines(
  lakes: LakeIndexEntry[],
): Promise<GeoJSON.FeatureCollection> {
  const groups = await Promise.all(
    lakes.map(async (lake) => {
      const res = await globalThis.fetch(`${lake.path}/shoreline.geojson`);
      if (!res.ok) {
        throw new Error(`Failed to load shoreline for ${lake.id}`);
      }
      const fc = (await res.json()) as GeoJSON.FeatureCollection;
      return fc.features.map((f) => ({
        ...f,
        properties: {
          ...(f.properties ?? {}),
          lakeId: lake.id,
          name: lake.name,
        },
      }));
    }),
  );
  return { type: "FeatureCollection", features: groups.flat() };
}

function walkCoords(
  coords: unknown,
  acc: { w: number; s: number; e: number; n: number },
) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    acc.w = Math.min(acc.w, coords[0]);
    acc.e = Math.max(acc.e, coords[0]);
    acc.s = Math.min(acc.s, coords[1]);
    acc.n = Math.max(acc.n, coords[1]);
    return;
  }
  for (const c of coords) walkCoords(c, acc);
}

export function shorelineBoundsByLake(
  fc: GeoJSON.FeatureCollection,
): Record<string, { west: number; south: number; east: number; north: number }> {
  const boxes = new Map<
    string,
    { w: number; s: number; e: number; n: number }
  >();
  for (const f of fc.features) {
    const id = f.properties?.lakeId;
    if (typeof id !== "string" || !f.geometry) continue;
    let acc = boxes.get(id);
    if (!acc) {
      acc = { w: Infinity, s: Infinity, e: -Infinity, n: -Infinity };
      boxes.set(id, acc);
    }
    walkCoords(f.geometry.coordinates, acc);
  }
  const out: Record<
    string,
    { west: number; south: number; east: number; north: number }
  > = {};
  for (const [id, acc] of boxes) {
    if (!Number.isFinite(acc.w)) continue;
    out[id] = { west: acc.w, south: acc.s, east: acc.e, north: acc.n };
  }
  return out;
}

export async function loadLakeGrids(basePath: string): Promise<{
  grids: LakeGrids;
  spot: SpotProfile;
  shoreline: GeoJSON.FeatureCollection;
  depthContours: GeoJSON.FeatureCollection;
}> {
  const [metaRes, depthRes, fetchFileRes, spotRes, shoreRes, contourRes] =
    await Promise.all([
      globalThis.fetch(`${basePath}/grid.json`),
      globalThis.fetch(`${basePath}/depth.bin`),
      globalThis.fetch(`${basePath}/fetch_16dir.bin`),
      globalThis.fetch(`${basePath}/spot-profile.json`),
      globalThis.fetch(`${basePath}/shoreline.geojson`),
      globalThis.fetch(`${basePath}/depth-contours.geojson`),
    ]);
  if (
    !metaRes.ok ||
    !depthRes.ok ||
    !fetchFileRes.ok ||
    !spotRes.ok ||
    !shoreRes.ok
  ) {
    throw new Error(`Failed to load lake assets from ${basePath}`);
  }

  const meta = (await metaRes.json()) as GridJson;
  const depthBuf = await depthRes.arrayBuffer();
  const fetchBuf = await fetchFileRes.arrayBuffer();
  const spot = (await spotRes.json()) as SpotProfile;
  const shoreline = (await shoreRes.json()) as GeoJSON.FeatureCollection;
  const depthContours = contourRes.ok
    ? ((await contourRes.json()) as GeoJSON.FeatureCollection)
    : { type: "FeatureCollection", features: [] };

  const n = meta.ncols * meta.nrows;
  const depth = new Float32Array(depthBuf);
  const fetchGrid = new Float32Array(fetchBuf);
  if (depth.length !== n) {
    throw new Error(`depth.bin length ${depth.length} != ${n}`);
  }
  if (fetchGrid.length !== meta.nDirs * n) {
    throw new Error(
      `fetch_16dir.bin length ${fetchGrid.length} != ${meta.nDirs * n}`,
    );
  }

  return {
    grids: { meta, depth, fetch: fetchGrid, waveStats: waveStatsFromGrid(meta) },
    spot,
    shoreline,
    depthContours,
  };
}
