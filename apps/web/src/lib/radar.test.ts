import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expandRadarTimes,
  formatRadarRate,
  parseRadarDimension,
  radarLegendGradientCss,
  RADAR_LEGEND_STOPS,
  radarTileUrl,
  resolveRadarFrame,
  sampleRadarLegend,
  type RadarWindows,
} from "./radar.ts";

const OBS_XML = `
<Dimension name="time" units="ISO8601" default="2026-08-20T19:24:00Z" nearestValue="0">2026-08-20T16:24:00Z/2026-08-20T19:24:00Z/PT6M</Dimension>
`;

const EXTRA_XML = `
<Dimension name="time" units="ISO8601" default="2026-08-20T19:18:00Z" nearestValue="0">2026-08-20T19:18:00Z/2026-08-20T20:30:00Z/PT6M</Dimension>
`;

function windows(): RadarWindows {
  const observed = parseRadarDimension(OBS_XML);
  const nowcast = parseRadarDimension(EXTRA_XML);
  assert.ok(observed);
  assert.ok(nowcast);
  return { observed, nowcast };
}

describe("radar time windows", () => {
  it("expands PT6M ranges", () => {
    const times = expandRadarTimes(
      "2026-08-20T19:18:00Z/2026-08-20T19:30:00Z/PT6M",
    );
    assert.deepEqual(times, [
      "2026-08-20T19:18:00Z",
      "2026-08-20T19:24:00Z",
      "2026-08-20T19:30:00Z",
    ]);
  });

  it("snaps an hour inside the observed archive", () => {
    const frame = resolveRadarFrame(
      Date.parse("2026-08-20T18:00:00Z"),
      windows(),
    );
    assert.equal(frame.kind, "observed");
    assert.equal(frame.timeIso, "2026-08-20T18:00:00Z");
  });

  it("uses nowcast after the latest observation", () => {
    const frame = resolveRadarFrame(
      Date.parse("2026-08-20T20:00:00Z"),
      windows(),
    );
    assert.equal(frame.kind, "nowcast");
    assert.equal(frame.timeIso, "2026-08-20T20:00:00Z");
    assert.equal(
      frame.layers[1]?.wmsLayer,
      "Radar_1km_RainPrecipRate-Extrapolation",
    );
  });

  it("hides radar outside the live window", () => {
    const frame = resolveRadarFrame(
      Date.parse("2026-08-21T12:00:00Z"),
      windows(),
    );
    assert.equal(frame.kind, "none");
    assert.equal(frame.timeIso, null);
  });

  it("follows the latest observed frame when live", () => {
    const frame = resolveRadarFrame(
      Date.parse("2026-08-20T20:00:00Z"),
      windows(),
      true,
    );
    assert.equal(frame.kind, "observed");
    assert.equal(frame.timeIso, "2026-08-20T19:24:00Z");
  });

  it("prefers observed over nowcast while still in the archive", () => {
    const frame = resolveRadarFrame(
      Date.parse("2026-08-20T19:20:00Z"),
      windows(),
    );
    assert.equal(frame.kind, "observed");
    assert.equal(frame.timeIso, "2026-08-20T19:18:00Z");
  });
});

describe("radar colorbar", () => {
  it("matches the 14-color ECCC rain legend", () => {
    assert.equal(RADAR_LEGEND_STOPS.length, 14);
    assert.equal(sampleRadarLegend(0).rate, 0.1);
    assert.deepEqual(sampleRadarLegend(0).rgb, [25, 161, 254]);
    assert.equal(sampleRadarLegend(1).rate, 200);
    assert.deepEqual(sampleRadarLegend(1).rgb, [51, 0, 77]);
    assert.match(radarLegendGradientCss(), /^linear-gradient\(90deg,/);
    assert.equal(formatRadarRate(0.1), "0.1 mm/h");
    assert.equal(formatRadarRate(16), "16 mm/h");
  });

  it("pins GeoMet 14-color styles on tile URLs", () => {
    assert.match(radarTileUrl("RADAR_1KM_RRAI"), /STYLES=Radar-Rain_14colors/);
    assert.match(radarTileUrl("RADAR_1KM_RSNO"), /STYLES=Radar-Snow_14colors/);
    assert.match(
      radarTileUrl("Radar_1km_SnowPrecipRate-Extrapolation"),
      /STYLES=Radar-Snow_14colors/,
    );
  });
});
