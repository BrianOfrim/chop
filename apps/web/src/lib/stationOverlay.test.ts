import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  drawStations,
  formatStationWindLabel,
} from "./stationOverlay.ts";
import type { StationFeature, StationsResponse } from "./stations.ts";

type Call = { op: string; args: unknown[] };

function recordingContext(): {
  ctx: CanvasRenderingContext2D;
  calls: Call[];
} {
  const calls: Call[] = [];
  const rec =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args });
    };
  const ctx = {
    beginPath: rec("beginPath"),
    moveTo: rec("moveTo"),
    lineTo: rec("lineTo"),
    closePath: rec("closePath"),
    stroke: rec("stroke"),
    fill: rec("fill"),
    arc: rec("arc"),
    save: rec("save"),
    restore: rec("restore"),
    translate: rec("translate"),
    rotate: rec("rotate"),
    fillText: rec("fillText"),
    strokeText: rec("strokeText"),
    setTransform: rec("setTransform"),
    clearRect: rec("clearRect"),
    lineJoin: "miter",
    lineCap: "butt",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    strokeStyle: "",
    fillStyle: "",
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function fakeCanvas(ctx: CanvasRenderingContext2D): HTMLCanvasElement {
  return {
    parentElement: { clientWidth: 400, clientHeight: 300 },
    clientWidth: 400,
    clientHeight: 300,
    width: 400,
    height: 300,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
}

function station(partial: Partial<StationFeature["properties"]>): StationFeature {
  return {
    type: "Feature",
    id: "s1",
    geometry: { type: "Point", coordinates: [-114.1, 53.0] },
    properties: {
      id: "s1",
      name: "Pigeon Lake",
      network: "CA",
      provider: "MSC",
      autoMan: null,
      mscId: null,
      icao: null,
      wmo: null,
      observedAt: "2026-08-22T18:00:00Z",
      airTempC: 18,
      windSpeedMps: 6.17,
      windDirDeg: 270,
      windGustMps: null,
      relHum: null,
      bearing: 270,
      hasWind: 1,
      hasObs: 1,
      ...partial,
    },
  };
}

function collection(features: StationFeature[]): StationsResponse {
  return {
    fetchedAt: "2026-08-22T18:00:00Z",
    source: "test",
    status: "ok",
    type: "FeatureCollection",
    features,
  };
}

describe("station overlay", () => {
  it("formats the current wind speed in the user's unit", () => {
    assert.equal(formatStationWindLabel(6.17, "kt"), "12 kt");
    assert.equal(formatStationWindLabel(5, "mps"), "5.0 m/s");
    assert.equal(formatStationWindLabel(null, "kt"), null);
    assert.equal(formatStationWindLabel(Number.NaN, "kt"), null);
  });

  it("paints a diamond mark and the speed, not a circular pin", () => {
    const { ctx, calls } = recordingContext();
    drawStations(
      fakeCanvas(ctx),
      {
        project: () => ({ x: 200, y: 150 }),
        getZoom: () => 9,
      } as never,
      collection([station()]),
      false,
      null,
      "kt",
    );
    const arcs = calls.filter((c) => c.op === "arc");
    assert.equal(arcs.length, 0, "stations are diamonds, not circles");
    const diamond = calls.filter((c) => c.op === "lineTo");
    assert.ok(diamond.length >= 3, "diamond sides are stroked");
    const speeds = calls.filter(
      (c) => c.op === "fillText" && c.args[0] === "12 kt",
    );
    assert.equal(speeds.length, 1, "current wind speed sits next to the station");
    assert.ok((speeds[0]!.args[1] as number) > 200, "speed is to the right");
  });

  it("omits the speed when the station has no wind observation", () => {
    const { ctx, calls } = recordingContext();
    drawStations(
      fakeCanvas(ctx),
      {
        project: () => ({ x: 200, y: 150 }),
        getZoom: () => 9,
      } as never,
      collection([
        station({
          windSpeedMps: null,
          hasWind: 0,
          bearing: null,
        }),
      ]),
      false,
      null,
      "kt",
    );
    assert.ok(!calls.some((c) => c.op === "fillText" && String(c.args[0]).includes("kt")));
  });
});
