import { describe, expect, it } from "vitest";
import { depthLimitHs, smbHs, smbHsDepthLimited } from "../src/smb.js";
import { approxMaxHs, approxMaxHsOverWind, computeHsGrid, computeHsGridFromWind, hsAtLonLat, type FetchDirStats } from "../src/grid.js";

describe("smbHs", () => {
  it("returns 0 for non-positive inputs", () => {
    expect(smbHs(0, 1000)).toBe(0);
    expect(smbHs(10, 0)).toBe(0);
  });

  it("grows with fetch and wind at U=10 m/s", () => {
    const short = smbHs(10, 1000);
    const long = smbHs(10, 10000);
    expect(long).toBeGreaterThan(short);
    expect(short).toBeGreaterThan(0.05);
    expect(long).toBeLessThan(1.5);
  });

  it("matches rough Pigeon open-water scale (~0.4–0.8 m at 10 m/s, multi-km fetch)", () => {
    // Pigeon metadata at U=10 m/s: mean Hs ~35–50 cm, max ~60–80 cm depending on dir
    const hs = smbHs(10, 8000);
    expect(hs).toBeGreaterThan(0.3);
    expect(hs).toBeLessThan(0.9);
  });
});

describe("depthLimitHs", () => {
  it("caps at 0.4 * depth", () => {
    expect(depthLimitHs(2, 2)).toBeCloseTo(0.8, 5);
    expect(depthLimitHs(0.3, 2)).toBeCloseTo(0.3, 5);
  });
});

describe("smbHsDepthLimited", () => {
  it("applies both fetch growth and shallow cap", () => {
    const deep = smbHsDepthLimited(10, 10000, 20);
    const shallow = smbHsDepthLimited(10, 10000, 1);
    expect(shallow).toBeLessThan(deep);
    expect(shallow).toBeCloseTo(0.4, 5);
  });
});

describe("approxMaxHs", () => {
  const stats: FetchDirStats = {
    directionsDeg: [0, 90, 180, 270],
    fetchMaxByDirM: [1000, 8000, 1000, 10000],
    depthAtFetchMaxByDirM: [10, 10, 10, 1],
  };

  it("uses the max-fetch cell for the nearest direction bin", () => {
    const east = approxMaxHs(10, 90, stats);
    const north = approxMaxHs(10, 0, stats);
    expect(east).toBeGreaterThan(north);
    expect(east).toBeCloseTo(smbHsDepthLimited(10, 8000, 10), 5);
  });

  it("applies the depth cap at that cell", () => {
    const west = approxMaxHs(10, 270, stats);
    expect(west).toBeCloseTo(0.4, 5);
  });
});

describe("computeHsGrid", () => {
  const meta = {
    ncols: 2,
    nrows: 1,
    west: 0,
    south: 0,
    east: 2,
    north: 1,
    cellSizeM: 50,
    nodata: -1,
    nDirs: 2,
    directionsDeg: [90, 270],
    crs: "EPSG:4326",
  };
  const grids = {
    meta,
    depth: new Float32Array([10, -1]),
    fetch: new Float32Array([
      8000, 0, // dir 90
      1000, 0, // dir 270
    ]),
  };

  it("writes Hs on water and NaN on land", () => {
    const hs = computeHsGrid(grids, 10, 90);
    expect(hs[0]).toBeCloseTo(smbHsDepthLimited(10, 8000, 10), 5);
    expect(Number.isNaN(hs[1]!)).toBe(true);
  });

  it("matches hsAtLonLat at the water cell", () => {
    const hs = computeHsGrid(grids, 10, 90);
    const at = hsAtLonLat(grids, 0.4, 0.5, 10, 90);
    expect(at).toBeCloseTo(hs[0]!, 5);
  });
});

describe("computeHsGridFromWind", () => {
  const meta = {
    ncols: 2,
    nrows: 1,
    west: 0,
    south: 0,
    east: 2,
    north: 1,
    cellSizeM: 50,
    nodata: -1,
    nDirs: 2,
    directionsDeg: [90, 270],
    crs: "EPSG:4326",
  };
  const grids = {
    meta,
    depth: new Float32Array([10, 10]),
    fetch: new Float32Array([
      8000, 8000,
      1000, 1000,
    ]),
  };

  it("falls back to uniform computeHsGrid", () => {
    const wind = {
      west: 0,
      south: 0,
      east: 2,
      north: 1,
      ncols: 1,
      nrows: 1,
      speed: new Float32Array([10]),
      dir: new Float32Array([90]),
      uniform: true,
    };
    const spatial = computeHsGridFromWind(grids, wind);
    const uniform = computeHsGrid(grids, 10, 90);
    expect(spatial[0]).toBeCloseTo(uniform[0]!, 5);
    expect(spatial[1]).toBeCloseTo(uniform[1]!, 5);
  });

  it("uses local wind so Hs can differ across the lake", () => {
    const wind = {
      west: 0,
      south: 0,
      east: 2,
      north: 1,
      ncols: 2,
      nrows: 1,
      speed: new Float32Array([5, 12]),
      dir: new Float32Array([90, 90]),
    };
    const hs = computeHsGridFromWind(grids, wind);
    expect(hs[1]!).toBeGreaterThan(hs[0]!);
    expect(hs[0]).toBeCloseTo(smbHsDepthLimited(5, 8000, 10), 5);
    expect(hs[1]).toBeCloseTo(smbHsDepthLimited(12, 8000, 10), 5);
  });
});

describe("approxMaxHsOverWind", () => {
  const stats: FetchDirStats = {
    directionsDeg: [90],
    fetchMaxByDirM: [8000],
    depthAtFetchMaxByDirM: [10],
  };

  it("takes the max over overlapping wind cells", () => {
    const wind = {
      west: 0,
      south: 0,
      east: 2,
      north: 1,
      ncols: 2,
      nrows: 1,
      speed: new Float32Array([5, 12]),
      dir: new Float32Array([90, 90]),
    };
    const max = approxMaxHsOverWind(stats, wind, {
      west: 0.1,
      south: 0.1,
      east: 1.9,
      north: 0.9,
    });
    expect(max).toBeCloseTo(approxMaxHs(12, 90, stats), 5);
    expect(max).toBeGreaterThan(approxMaxHs(5, 90, stats));
  });
});
