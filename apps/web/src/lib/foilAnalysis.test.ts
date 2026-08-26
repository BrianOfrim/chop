import { describe, expect, it } from "vitest";
import type { GpxPoint, GpxTrack } from "./gpx";
import {
  analyzeFoilSession,
  DEFAULT_FOIL_THRESHOLDS,
} from "./foilAnalysis";
import type { WindHour } from "./wind";

const ORIGIN = { lat: 53.1, lon: -114.0 };
const NORTH_WIND: WindHour[] = [
  {
    time: "2026-06-01T12:00:00.000Z",
    windSpeedMps: 8,
    windDirDeg: 0,
    gustMps: null,
    weatherCode: null,
    precipMm: 0,
    tempC: 18,
  },
];

function dest(
  lat: number,
  lon: number,
  bearingDeg: number,
  distM: number,
): { lat: number; lon: number } {
  const R = 6371000;
  const δ = distM / R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return { lat: (φ2 * 180) / Math.PI, lon: (λ2 * 180) / Math.PI };
}

type Leg = { heading: number; speed: number; seconds: number };

function walk(startMs: number, legs: Leg[]): GpxPoint[] {
  const points: GpxPoint[] = [];
  let lat = ORIGIN.lat;
  let lon = ORIGIN.lon;
  let t = startMs;
  let first = true;
  for (const leg of legs) {
    for (let s = first ? 0 : 1; s <= leg.seconds; s++) {
      if (!first && s === 0) continue;
      if (s > 0) {
        const step = dest(lat, lon, leg.heading, leg.speed);
        lat = step.lat;
        lon = step.lon;
        t += 1000;
      }
      points.push({
        lon,
        lat,
        time: new Date(t).toISOString(),
        timeMs: t,
        speedMps: leg.speed,
      });
      first = false;
    }
  }
  return points;
}

function trackFrom(points: GpxPoint[], name = "session"): GpxTrack {
  const coords = points.map((p) => [p.lon, p.lat] as [number, number]);
  return {
    name,
    filename: `${name}.gpx`,
    label: name,
    startTime: points[0]?.time ?? null,
    endTime: points[points.length - 1]?.time ?? null,
    pointCount: points.length,
    points,
    bounds: { west: -115, south: 52, east: -113, north: 54 },
    geojson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { kind: "track" },
          geometry: { type: "LineString", coordinates: coords },
        },
        {
          type: "Feature",
          properties: { kind: "start" },
          geometry: { type: "Point", coordinates: coords[0]! },
        },
        {
          type: "Feature",
          properties: { kind: "end" },
          geometry: { type: "Point", coordinates: coords[coords.length - 1]! },
        },
      ],
    },
  };
}

describe("analyzeFoilSession", () => {
  it("returns null without enough timed points", () => {
    expect(analyzeFoilSession(trackFrom([]), NORTH_WIND)).toBeNull();
    expect(
      analyzeFoilSession(
        trackFrom([
          {
            lon: 0,
            lat: 0,
            time: "2026-06-01T12:00:00.000Z",
            timeMs: Date.parse("2026-06-01T12:00:00.000Z"),
            speedMps: 5,
          },
        ]),
        NORTH_WIND,
      ),
    ).toBeNull();
  });

  it("detects a clean flight with touchdown, not a fall", () => {
    const t0 = Date.parse("2026-06-01T12:00:00.000Z");
    const track = trackFrom(
      walk(t0, [
        { heading: 90, speed: 0.8, seconds: 5 },
        { heading: 90, speed: 5.2, seconds: 20 },
        { heading: 90, speed: 1.2, seconds: 10 },
      ]),
    );
    const analysis = analyzeFoilSession(track, NORTH_WIND);
    expect(analysis).not.toBeNull();
    expect(analysis!.stats.flightCount).toBe(1);
    expect(analysis!.stats.foilDurationSec).toBeGreaterThan(15);
    expect(analysis!.stats.foilTimePct).toBeGreaterThan(40);
    expect(analysis!.stats.foilDistanceM).toBeGreaterThan(50);
    expect(analysis!.stats.timeToFirstFlightSec).toBeGreaterThan(2);
    expect(analysis!.stats.falls).toBe(0);
    expect(analysis!.stats.touchdowns).toBe(1);
    expect(analysis!.stats.tacks.attempted).toBe(0);
    expect(analysis!.stats.jibes.attempted).toBe(0);
    expect(analysis!.points.some((p) => p.onFoil)).toBe(true);
  });

  it("classifies a successful port tack through upwind", () => {
    const t0 = Date.parse("2026-06-01T12:00:00.000Z");
    const track = trackFrom(
      walk(t0, [
        { heading: 90, speed: 5.2, seconds: 10 },
        { heading: 60, speed: 5.2, seconds: 1 },
        { heading: 30, speed: 5.2, seconds: 1 },
        { heading: 0, speed: 5.2, seconds: 1 },
        { heading: 330, speed: 5.2, seconds: 1 },
        { heading: 300, speed: 5.2, seconds: 1 },
        { heading: 270, speed: 5.2, seconds: 10 },
      ]),
    );
    const analysis = analyzeFoilSession(track, NORTH_WIND);
    expect(analysis).not.toBeNull();
    expect(analysis!.stats.tacks.attempted).toBe(1);
    expect(analysis!.stats.tacks.made).toBe(1);
    expect(analysis!.stats.tacks.port.made).toBe(1);
    expect(analysis!.stats.jibes.attempted).toBe(0);
    expect(analysis!.maneuvers[0]!.success).toBe(true);
    expect(analysis!.maneuvers[0]!.type).toBe("tack");
    expect(analysis!.maneuvers[0]!.side).toBe("port");
  });

  it("does not infer a tack across a 5 s GPS hole", () => {
    const t0 = Date.parse("2026-06-01T12:00:00.000Z");
    const points = walk(t0, [
      { heading: 90, speed: 5.2, seconds: 10 },
      { heading: 60, speed: 5.2, seconds: 1 },
      { heading: 30, speed: 5.2, seconds: 1 },
      { heading: 0, speed: 5.2, seconds: 1 },
      { heading: 330, speed: 5.2, seconds: 1 },
      { heading: 300, speed: 5.2, seconds: 1 },
      { heading: 270, speed: 5.2, seconds: 10 },
    ]);
    for (const p of points) {
      if (p.timeMs != null && (p.timeMs - t0) / 1000 >= 12) {
        p.timeMs += 5000;
        p.time = new Date(p.timeMs).toISOString();
      }
    }
    const analysis = analyzeFoilSession(trackFrom(points), NORTH_WIND);
    expect(analysis).not.toBeNull();
    expect(analysis!.stats.tacks.attempted).toBe(0);
    expect(analysis!.maneuvers.filter((m) => m.type === "tack")).toHaveLength(0);
  });

  it("classifies a successful starboard jibe that holds the new reach", () => {
    const t0 = Date.parse("2026-06-01T12:00:00.000Z");
    const track = trackFrom(
      walk(t0, [
        { heading: 90, speed: 5.2, seconds: 8 },
        { heading: 120, speed: 5.2, seconds: 1 },
        { heading: 150, speed: 5.2, seconds: 1 },
        { heading: 180, speed: 5.2, seconds: 1 },
        { heading: 210, speed: 5.2, seconds: 1 },
        { heading: 240, speed: 5.2, seconds: 1 },
        { heading: 270, speed: 5.2, seconds: 8 },
      ]),
    );
    const analysis = analyzeFoilSession(track, NORTH_WIND);
    expect(analysis).not.toBeNull();
    expect(analysis!.stats.jibes.attempted).toBe(1);
    expect(analysis!.stats.jibes.made).toBe(1);
    expect(analysis!.stats.tacks.attempted).toBe(0);
    expect(analysis!.maneuvers[0]!.type).toBe("jibe");
    expect(analysis!.maneuvers[0]!.success).toBe(true);
  });

  it("does not count a downwind heading change as a jibe", () => {
    const t0 = Date.parse("2026-06-01T12:00:00.000Z");
    const track = trackFrom(
      walk(t0, [
        { heading: 170, speed: 5.2, seconds: 8 },
        { heading: 200, speed: 5.2, seconds: 1 },
        { heading: 230, speed: 5.2, seconds: 1 },
        { heading: 260, speed: 5.2, seconds: 1 },
        { heading: 280, speed: 5.2, seconds: 8 },
      ]),
    );
    const analysis = analyzeFoilSession(track, NORTH_WIND);
    expect(analysis).not.toBeNull();
    expect(analysis!.stats.jibes.attempted).toBe(0);
    expect(analysis!.stats.tacks.attempted).toBe(0);
    expect(analysis!.maneuvers).toHaveLength(0);
  });

  it("does not count a slow 15 s heading drift as a maneuver", () => {
    const t0 = Date.parse("2026-06-01T12:00:00.000Z");
    const legs: Leg[] = [{ heading: 90, speed: 5.2, seconds: 6 }];
    for (let h = 100; h <= 230; h += 10) {
      legs.push({ heading: h, speed: 5.2, seconds: 1 });
    }
    legs.push({ heading: 230, speed: 5.2, seconds: 6 });
    const analysis = analyzeFoilSession(trackFrom(walk(t0, legs)), NORTH_WIND);
    expect(analysis).not.toBeNull();
    expect(analysis!.maneuvers).toHaveLength(0);
  });

  it("does not split one turn into two successful tacks", () => {
    const t0 = Date.parse("2026-06-01T12:00:00.000Z");
    const track = trackFrom(
      walk(t0, [
        { heading: 90, speed: 5.2, seconds: 8 },
        { heading: 60, speed: 5.2, seconds: 1 },
        { heading: 30, speed: 5.2, seconds: 1 },
        { heading: 0, speed: 5.2, seconds: 1 },
        { heading: 330, speed: 5.2, seconds: 1 },
        { heading: 300, speed: 5.2, seconds: 1 },
        { heading: 270, speed: 5.2, seconds: 1 },
        { heading: 240, speed: 5.2, seconds: 1 },
        { heading: 210, speed: 5.2, seconds: 8 },
      ]),
    );
    const analysis = analyzeFoilSession(track, NORTH_WIND);
    expect(analysis).not.toBeNull();
    const madeTacks = analysis!.maneuvers.filter((m) => m.type === "tack" && m.success);
    expect(madeTacks.length).toBeLessThanOrEqual(1);
  });

  it("does not mark a tack made if heading never settles on the other reach", () => {
    const t0 = Date.parse("2026-06-01T12:00:00.000Z");
    const track = trackFrom(
      walk(t0, [
        { heading: 90, speed: 5.2, seconds: 8 },
        { heading: 60, speed: 5.2, seconds: 1 },
        { heading: 30, speed: 5.2, seconds: 1 },
        { heading: 0, speed: 5.2, seconds: 1 },
        { heading: 330, speed: 5.2, seconds: 1 },
        { heading: 300, speed: 5.2, seconds: 1 },
        { heading: 270, speed: 5.2, seconds: 1 },
        { heading: 90, speed: 5.2, seconds: 8 },
      ]),
    );
    const analysis = analyzeFoilSession(track, NORTH_WIND);
    expect(analysis).not.toBeNull();
    expect(analysis!.stats.tacks.made).toBe(0);
  });

  it("classifies a fall from recorded speed when EMA still lags above 1 kt", () => {
    const t0 = Date.parse("2026-06-01T12:00:00.000Z");
    const track = trackFrom(
      walk(t0, [
        { heading: 90, speed: 5.2, seconds: 15 },
        { heading: 90, speed: 1.7, seconds: 2 },
        { heading: 90, speed: 0.4, seconds: 8 },
      ]),
    );
    const analysis = analyzeFoilSession(track, NORTH_WIND);
    expect(analysis).not.toBeNull();
    expect(analysis!.stats.flightCount).toBe(1);
    expect(analysis!.stats.falls).toBe(1);
    expect(analysis!.stats.touchdowns).toBe(0);
    const fall = analysis!.segments.find((s) => s.endKind === "fall");
    expect(fall).toBeDefined();
    const end = analysis!.points[fall!.endIndex]!;
    expect(end.speedSmoothMps).toBeGreaterThan(analysis!.thresholds.fallMps);
    const window = analysis!.points.filter(
      (p) =>
        p.timeMs >= fall!.endTimeMs &&
        (p.timeMs - fall!.endTimeMs) / 1000 <=
          analysis!.thresholds.fallWindowSec,
    );
    expect(window.some((p) => p.speedMps < analysis!.thresholds.fallMps)).toBe(
      true,
    );
  });

  it("classifies a failed starboard jibe when speed collapses mid-turn", () => {
    const t0 = Date.parse("2026-06-01T12:00:00.000Z");
    const track = trackFrom(
      walk(t0, [
        { heading: 90, speed: 5.2, seconds: 10 },
        { heading: 120, speed: 5.0, seconds: 1 },
        { heading: 150, speed: 4.6, seconds: 1 },
        { heading: 180, speed: 3.2, seconds: 1 },
        { heading: 210, speed: 1.6, seconds: 1 },
        { heading: 240, speed: 0.5, seconds: 1 },
        { heading: 270, speed: 0.2, seconds: 8 },
      ]),
    );
    const analysis = analyzeFoilSession(track, NORTH_WIND);
    expect(analysis).not.toBeNull();
    expect(analysis!.stats.jibes.attempted).toBeGreaterThanOrEqual(1);
    expect(analysis!.stats.jibes.made).toBe(0);
    expect(analysis!.maneuvers.some((m) => m.type === "jibe" && !m.success)).toBe(
      true,
    );
    expect(analysis!.stats.falls).toBeGreaterThanOrEqual(1);
  });

  it("does not let a GPS position jump raise best 5 s above max", () => {
    const t0 = Date.parse("2026-06-01T12:00:00.000Z");
    const points = walk(t0, [{ heading: 90, speed: 5.2, seconds: 20 }]);
    const jumped = dest(points[10]!.lat, points[10]!.lon, 90, 30);
    points[10] = { ...points[10]!, lat: jumped.lat, lon: jumped.lon };
    const analysis = analyzeFoilSession(trackFrom(points), NORTH_WIND);
    expect(analysis).not.toBeNull();
    expect(analysis!.stats.best5sMps).not.toBeNull();
    expect(analysis!.stats.maxSpeedMps).not.toBeNull();
    expect(analysis!.stats.best5sMps!).toBeLessThanOrEqual(
      analysis!.stats.maxSpeedMps! + 0.05,
    );
  });

  it("rejects a one-sample GPS speed spike", () => {
    const t0 = Date.parse("2026-06-01T12:00:00.000Z");
    const points = walk(t0, [{ heading: 90, speed: 1.0, seconds: 30 }]);
    points[15] = { ...points[15]!, speedMps: 40 };
    const analysis = analyzeFoilSession(trackFrom(points), NORTH_WIND);
    expect(analysis).not.toBeNull();
    expect(analysis!.stats.flightCount).toBe(0);
    expect(analysis!.stats.maxSpeedMps).toBeLessThan(5);
  });

  it("uses hysteresis and merges brief touchdowns into one flight", () => {
    const t0 = Date.parse("2026-06-01T12:00:00.000Z");
    const track = trackFrom(
      walk(t0, [
        { heading: 90, speed: 5.2, seconds: 12 },
        { heading: 90, speed: 1.5, seconds: 2 },
        { heading: 90, speed: 5.2, seconds: 12 },
      ]),
    );
    const analysis = analyzeFoilSession(track, NORTH_WIND);
    expect(analysis).not.toBeNull();
    expect(analysis!.stats.flightCount).toBe(1);
    expect(analysis!.stats.foilDurationSec).toBeGreaterThan(20);
  });

  it("reports generic transitions when wind is missing", () => {
    const t0 = Date.parse("2026-06-01T12:00:00.000Z");
    const track = trackFrom(
      walk(t0, [
        { heading: 90, speed: 5.2, seconds: 10 },
        { heading: 60, speed: 5.2, seconds: 1 },
        { heading: 30, speed: 5.2, seconds: 1 },
        { heading: 0, speed: 5.2, seconds: 1 },
        { heading: 330, speed: 5.2, seconds: 1 },
        { heading: 300, speed: 5.2, seconds: 1 },
        { heading: 270, speed: 5.2, seconds: 10 },
      ]),
    );
    const analysis = analyzeFoilSession(track, []);
    expect(analysis).not.toBeNull();
    expect(analysis!.stats.hasWind).toBe(false);
    expect(analysis!.stats.transitions.attempted).toBe(1);
    expect(analysis!.stats.tacks.attempted).toBe(0);
    expect(analysis!.stats.jibes.attempted).toBe(0);
  });

  it("scales landing threshold with a custom takeoff speed", () => {
    const t0 = Date.parse("2026-06-01T12:00:00.000Z");
    const slow = 2.2;
    expect(slow).toBeLessThan(DEFAULT_FOIL_THRESHOLDS.takeoffMps);
    const track = trackFrom(
      walk(t0, [
        { heading: 90, speed: 0.6, seconds: 4 },
        { heading: 90, speed: slow, seconds: 16 },
        { heading: 90, speed: 0.6, seconds: 4 },
      ]),
    );
    const high = analyzeFoilSession(track, NORTH_WIND, { takeoffMps: 2.8 });
    const low = analyzeFoilSession(track, NORTH_WIND, { takeoffMps: 1.8 });
    expect(high!.stats.flightCount).toBe(0);
    expect(low!.stats.flightCount).toBe(1);
  });
});
