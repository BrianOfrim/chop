import { describe, expect, it } from "vitest";
import {
  chopHs,
  equivalentFetchM,
  windDurationSec,
  yvHs,
} from "../src/hs.js";
import { depthLimitHs, smbHs, smbHsDepthLimited } from "../src/smb.js";
import {
  approxMaxHs,
  approxMaxHsOverWind,
  computeHsGrid,
  computeHsGridFromWind,
  fetchAtDir,
  hsAtLonLat,
  type FetchDirStats,
} from "../src/grid.js";

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
    const hs = smbHs(10, 8000);
    expect(hs).toBeGreaterThan(0.3);
    expect(hs).toBeLessThan(0.9);
  });
});

describe("yvHs", () => {
  it("returns 0 for non-positive inputs", () => {
    expect(yvHs(0, 1000, 10)).toBe(0);
    expect(yvHs(10, 0, 10)).toBe(0);
    expect(yvHs(10, 1000, 0)).toBe(0);
  });

  it("grows with fetch at U=10 m/s", () => {
    const short = yvHs(10, 1000, 20);
    const long = yvHs(10, 10000, 20);
    expect(long).toBeGreaterThan(short);
    expect(short).toBeGreaterThan(0.05);
  });

  it("is below SMB at the same deep-water fetch", () => {
    expect(yvHs(10, 8000, 20)).toBeLessThan(smbHs(10, 8000));
  });

  it("slows growth in shallow water before the breaker cap binds", () => {
    const deep = yvHs(10, 10000, 20);
    const shallow = yvHs(10, 10000, 1);
    expect(shallow).toBeLessThan(deep);
    expect(shallow).toBeLessThan(0.4);
  });

  it("matches rough Pigeon open-water scale at 10 m/s, 8 km", () => {
    const hs = yvHs(10, 8000, 20);
    expect(hs).toBeGreaterThan(0.2);
    expect(hs).toBeLessThan(0.6);
  });
});

describe("chopHs", () => {
  it("applies the breaker cap after Young–Verhagen", () => {
    const deep = chopHs(10, 10000, 20);
    const shallow = chopHs(10, 10000, 1);
    expect(shallow).toBeLessThan(deep);
    expect(shallow).toBeLessThanOrEqual(0.4);
  });

  it("duration-limits short events and matches fetch-limited when duration is long", () => {
    const fetchLimited = chopHs(10, 8000, 20);
    const oneHour = chopHs(10, 8000, 20, 3600);
    const long = chopHs(10, 8000, 20, 24 * 3600);
    expect(oneHour).toBeGreaterThan(0);
    expect(oneHour).toBeLessThan(fetchLimited);
    expect(long).toBeCloseTo(fetchLimited, 5);
  });
});

describe("equivalentFetchM", () => {
  it("is about 3 km after one hour at 10 m/s", () => {
    const x = equivalentFetchM(10, 3600);
    expect(x).toBeGreaterThan(2000);
    expect(x).toBeLessThan(5000);
  });

  it("grows with duration", () => {
    expect(equivalentFetchM(10, 7200)).toBeGreaterThan(equivalentFetchM(10, 3600));
  });
});

describe("windDurationSec", () => {
  const hours = [
    { time: "2026-08-19T12:00:00Z", windSpeedMps: 8, windDirDeg: 0 },
    { time: "2026-08-19T13:00:00Z", windSpeedMps: 10, windDirDeg: 90 },
    { time: "2026-08-19T14:00:00Z", windSpeedMps: 11, windDirDeg: 95 },
    { time: "2026-08-19T15:00:00Z", windSpeedMps: 10, windDirDeg: 100 },
  ];

  it("is undefined when the event reaches the start of the series", () => {
    expect(windDurationSec(hours, 0)).toBeUndefined();
  });

  it("counts hours since the observed direction shift", () => {
    expect(windDurationSec(hours, 1)).toBe(3600);
    expect(windDurationSec(hours, 3)).toBe(3 * 3600);
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
    expect(east).toBeCloseTo(chopHs(10, 8000, 10), 5);
  });

  it("applies Young–Verhagen shallow growth at that cell", () => {
    const west = approxMaxHs(10, 270, stats);
    expect(west).toBeCloseTo(chopHs(10, 10000, 1), 5);
    expect(west).toBeLessThan(0.4);
  });
});

describe("fetchAtDir", () => {
  const meta = {
    ncols: 1,
    nrows: 1,
    west: 0,
    south: 0,
    east: 1,
    north: 1,
    cellSizeM: 50,
    nodata: -1,
    nDirs: 8,
    directionsDeg: [0, 45, 90, 135, 180, 225, 270, 315],
    crs: "EPSG:4326",
  };
  const fetch = new Float32Array([1000, 1000, 8000, 1000, 1000, 1000, 1000, 1000]);

  it("weights neighboring bins so a long ray is pulled down by short sides", () => {
    const f = fetchAtDir(fetch, meta, 0, 90);
    expect(f).toBeGreaterThan(4000);
    expect(f).toBeLessThan(8000);
    expect(f).toBeCloseTo(4500, 5);
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
    expect(hs[0]).toBeCloseTo(chopHs(10, 8000, 10), 5);
    expect(Number.isNaN(hs[1]!)).toBe(true);
  });

  it("matches hsAtLonLat at the water cell", () => {
    const hs = computeHsGrid(grids, 10, 90);
    const at = hsAtLonLat(grids, 0.4, 0.5, 10, 90);
    expect(at).toBeCloseTo(hs[0]!, 5);
  });

  it("duration-limits the grid", () => {
    const full = computeHsGrid(grids, 10, 90);
    const short = computeHsGrid(grids, 10, 90, 3600);
    expect(short[0]!).toBeLessThan(full[0]!);
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
    expect(hs[0]).toBeCloseTo(chopHs(5, 8000, 10), 5);
    expect(hs[1]).toBeCloseTo(chopHs(12, 8000, 10), 5);
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
