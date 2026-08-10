import { describe, expect, it } from "vitest";
import { depthLimitHs, smbHs, smbHsDepthLimited } from "../src/smb.js";

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
