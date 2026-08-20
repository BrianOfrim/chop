import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHART_W,
  buildClockIntervalLabels,
  buildHourLabels,
  buildTimeAxis,
  sliderInsetStyle,
} from "./forecastChart.ts";

describe("buildHourLabels", () => {
  it("labels each clock hour once for 6-minute radar frames", () => {
    const times = [
      "2026-08-20T18:00:00Z",
      "2026-08-20T18:06:00Z",
      "2026-08-20T18:12:00Z",
      "2026-08-20T19:00:00Z",
      "2026-08-20T19:06:00Z",
      "2026-08-20T20:00:00Z",
    ];
    const labels = buildHourLabels(times, (i) => i, 1);
    assert.equal(labels.length, 3);
    assert.deepEqual(
      labels.map((l) => l.x),
      [0, 3, 5],
    );
  });
});

describe("buildClockIntervalLabels", () => {
  it("places uniform 15-minute labels along a 6-minute series", () => {
    const times = [
      "2026-08-20T18:06:00Z",
      "2026-08-20T18:12:00Z",
      "2026-08-20T18:18:00Z",
      "2026-08-20T18:24:00Z",
      "2026-08-20T18:30:00Z",
      "2026-08-20T18:36:00Z",
    ];
    const labels = buildClockIntervalLabels(times, (i) => i * 10, 15);
    assert.equal(labels.length, 2);
    assert.ok(labels[0]!.text.includes("15") || labels[0]!.text.includes("30"));
    assert.ok(labels[1]!.text.includes("30"));
    assert.ok(labels[0]!.x > 0 && labels[0]!.x < 40);
  });
});

describe("time axis alignment", () => {
  it("places precip bars on the same centers as the radar slider thumb", () => {
    const n = 40;
    const axis = buildTimeAxis(n);
    const inset = sliderInsetStyle(n);
    const leftPct = (axis.xCenter(0) / CHART_W) * 100;
    const rightPct = ((CHART_W - axis.xCenter(n - 1)) / CHART_W) * 100;
    assert.equal(inset.paddingLeft, `${leftPct}%`);
    assert.equal(inset.paddingRight, `${rightPct}%`);
    const wetIndex = 12;
    assert.equal(axis.xBar(wetIndex) + axis.barW / 2, axis.xCenter(wetIndex));
  });
});
