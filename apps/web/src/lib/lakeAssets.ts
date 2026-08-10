import type { GridMeta, LakeGrids } from "@chop/wave-engine";

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

export async function loadLakeIndex(): Promise<LakeIndexEntry[]> {
  const res = await globalThis.fetch("/lakes/index.json");
  if (!res.ok) throw new Error("Failed to load lakes index");
  const data = (await res.json()) as { lakes: LakeIndexEntry[] };
  return data.lakes;
}

export async function loadLakeGrids(basePath: string): Promise<{
  grids: LakeGrids;
  spot: SpotProfile;
  shoreline: GeoJSON.FeatureCollection;
}> {
  const [metaRes, depthRes, fetchFileRes, spotRes, shoreRes] = await Promise.all([
    globalThis.fetch(`${basePath}/grid.json`),
    globalThis.fetch(`${basePath}/depth.bin`),
    globalThis.fetch(`${basePath}/fetch_16dir.bin`),
    globalThis.fetch(`${basePath}/spot-profile.json`),
    globalThis.fetch(`${basePath}/shoreline.geojson`),
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

  const meta = (await metaRes.json()) as GridMeta & { spotId?: string };
  const depthBuf = await depthRes.arrayBuffer();
  const fetchBuf = await fetchFileRes.arrayBuffer();
  const spot = (await spotRes.json()) as SpotProfile;
  const shoreline = (await shoreRes.json()) as GeoJSON.FeatureCollection;

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
    grids: { meta, depth, fetch: fetchGrid },
    spot,
    shoreline,
  };
}
