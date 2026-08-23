import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  drawFetchRay,
  fetchRayFeatures,
  resolveFetchRay,
} from "./fetchOverlay.ts";

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
    stroke: rec("stroke"),
    fill: rec("fill"),
    arc: rec("arc"),
    setLineDash: rec("setLineDash"),
    setTransform: rec("setTransform"),
    clearRect: rec("clearRect"),
    lineJoin: "miter",
    lineCap: "butt",
    lineWidth: 1,
    globalAlpha: 1,
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

const PIGEON_HOVER = {
  lon: -114.06,
  lat: 53.03,
  onWater: true,
  fetchM: 4200,
  windDirDeg: 270,
};

describe("fetch ray UI — lake hover point and line", () => {
  it("resolves a ray when the hover card has fetch distance", () => {
    const spec = resolveFetchRay(PIGEON_HOVER);
    assert.ok(spec);
    assert.equal(spec.lon, -114.06);
    assert.equal(spec.lat, 53.03);
    assert.equal(spec.windFromDeg, 270);
  });

  it("uses the hour-wind fallback when the Wind overlay has no field direction", () => {
    const spec = resolveFetchRay(
      { ...PIGEON_HOVER, windDirDeg: null },
      225,
    );
    assert.ok(spec);
    assert.equal(spec.windFromDeg, 225);
  });

  it("does not resolve a ray off-water or without fetch", () => {
    assert.equal(resolveFetchRay({ ...PIGEON_HOVER, onWater: false }), null);
    assert.equal(resolveFetchRay({ ...PIGEON_HOVER, fetchM: 0 }), null);
    assert.equal(resolveFetchRay({ ...PIGEON_HOVER, fetchM: null }), null);
    assert.equal(
      resolveFetchRay({ ...PIGEON_HOVER, windDirDeg: null }, null),
      null,
    );
  });

  it("builds a line plus hover and shore points", () => {
    const spec = resolveFetchRay(PIGEON_HOVER)!;
    const fc = fetchRayFeatures(spec, [-114.12, 53.03]);
    const kinds = fc.features.map((f) => f.properties?.kind);
    assert.deepEqual(kinds, ["fetch-ray", "hover", "shore"]);
    const line = fc.features[0]!;
    assert.equal(line.geometry.type, "LineString");
    if (line.geometry.type === "LineString") {
      assert.deepEqual(line.geometry.coordinates[0], [-114.06, 53.03]);
      assert.deepEqual(line.geometry.coordinates[1], [-114.12, 53.03]);
    }
    const hover = fc.features[1]!;
    assert.equal(hover.geometry.type, "Point");
    if (hover.geometry.type === "Point") {
      assert.deepEqual(hover.geometry.coordinates, [-114.06, 53.03]);
    }
  });

  it("paints the dashed fetch line and the hover point on the overlay", () => {
    const { ctx, calls } = recordingContext();
    const spec = resolveFetchRay(PIGEON_HOVER)!;
    const ray = fetchRayFeatures(spec, [-114.12, 53.03]);
    drawFetchRay(
      fakeCanvas(ctx),
      {
        project: ([lon, lat]) => ({
          x: (lon + 114.2) * 200,
          y: (53.2 - lat) * 200,
        }),
      },
      ray,
      false,
      { clear: false },
    );
    const ops = calls.map((c) => c.op);
    assert.ok(ops.includes("lineTo"), "fetch line is stroked");
    assert.ok(ops.includes("stroke"), "fetch line is stroked");
    assert.ok(
      calls.some((c) => c.op === "setLineDash" && (c.args[0] as number[])[0] > 0),
      "fetch line is dashed",
    );
    const hoverArc = calls.find(
      (c) => c.op === "arc" && c.args[2] === 4.5,
    );
    assert.ok(hoverArc, "hover point is drawn");
    const shoreArc = calls.find(
      (c) => c.op === "arc" && c.args[2] === 3.5,
    );
    assert.ok(shoreArc, "shore point is drawn");
  });
});
