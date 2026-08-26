import { describe, expect, it } from "vitest";
import {
  formatStationModelWindDelta,
  signedAngleDiffDeg,
} from "./stationModelDelta";

describe("signedAngleDiffDeg", () => {
  it("returns the shortest signed turn", () => {
    expect(signedAngleDiffDeg(270, 280)).toBe(10);
    expect(signedAngleDiffDeg(280, 270)).toBe(-10);
    expect(signedAngleDiffDeg(350, 10)).toBe(20);
    expect(signedAngleDiffDeg(10, 350)).toBe(-20);
    expect(signedAngleDiffDeg(0, 180)).toBe(180);
    expect(signedAngleDiffDeg(90, 90)).toBe(0);
  });
});

describe("formatStationModelWindDelta", () => {
  it("formats station minus model in the user's wind unit", () => {
    expect(
      formatStationModelWindDelta(6.17, 270, { speedMps: 5.14, dirDeg: 265 }, "kt"),
    ).toBe("Model 10 kt from W · Δ +2 kt · +5°");
    expect(
      formatStationModelWindDelta(6, 180, { speedMps: 8, dirDeg: 180 }, "mps"),
    ).toBe("Model 8.0 m/s from S · Δ -2.0 m/s · 0°");
    expect(
      formatStationModelWindDelta(4.9, 137, { speedMps: 4.17, dirDeg: 166 }, "kt"),
    ).toBe("Model 8 kt from SSE · Δ +2 kt · -29°");
  });

  it("omits the line when the model or station wind is missing", () => {
    expect(
      formatStationModelWindDelta(6, 270, null, "kt"),
    ).toBeNull();
    expect(
      formatStationModelWindDelta(null, null, { speedMps: 5, dirDeg: 270 }, "kt"),
    ).toBeNull();
    expect(
      formatStationModelWindDelta(6, 270, { speedMps: Number.NaN, dirDeg: 270 }, "kt"),
    ).toBeNull();
  });

  it("still reports a speed-only delta when direction is missing", () => {
    expect(
      formatStationModelWindDelta(8, null, { speedMps: 5.14, dirDeg: 90 }, "kt"),
    ).toBe("Model 10 kt from E · Δ +6 kt");
  });
});
