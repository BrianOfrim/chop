import { describe, expect, it } from "vitest";
import { buildTimeAxis, xAtTimeMs } from "./forecastChart";

describe("xAtTimeMs", () => {
  it("interpolates between sample times on the shared chart axis", () => {
    const times = [{ timeMs: 0 }, { timeMs: 1000 }, { timeMs: 2000 }];
    const axis = buildTimeAxis(times.length);
    expect(xAtTimeMs(0, times, axis.xCenter)).toBe(axis.xCenter(0));
    expect(xAtTimeMs(2000, times, axis.xCenter)).toBe(axis.xCenter(2));
    expect(xAtTimeMs(500, times, axis.xCenter)).toBeCloseTo(
      (axis.xCenter(0) + axis.xCenter(1)) / 2,
    );
  });

  it("clamps to the first and last sample", () => {
    const times = [{ timeMs: 100 }, { timeMs: 200 }];
    const axis = buildTimeAxis(times.length);
    expect(xAtTimeMs(0, times, axis.xCenter)).toBe(axis.xCenter(0));
    expect(xAtTimeMs(500, times, axis.xCenter)).toBe(axis.xCenter(1));
  });
});
