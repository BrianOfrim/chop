import { describe, expect, it } from "vitest";
import {
  hitReviewTrack,
  reviewFocusRange,
  reviewPolylinePoints,
  sliceTrackFocus,
  TRACK_FADE_SPAN_M,
  TRACK_FOCUS_M,
  TRACK_PAST_FADE_SPAN_M,
  TRACK_PAST_FOCUS_M,
  trackFocusAlpha,
  trackSpeedColorCss,
  type ReviewFoilOverlay,
} from "./reviewPath";
import type { GpxTrack } from "./gpx";

const map = {
  project: ([lon, lat]: [number, number]) => ({ x: lon, y: lat }),
};

const LINE = [
  { lon: 0, lat: 0, timeMs: 1_000, speedMps: 4, onFoil: false },
  { lon: 100, lat: 0, timeMs: 2_000, speedMps: 8, onFoil: true },
  { lon: 100, lat: 50, timeMs: 3_000, speedMps: 6, onFoil: true },
];

describe("hitReviewTrack", () => {
  it("returns null when the pointer is away from the track", () => {
    expect(hitReviewTrack(map, LINE, { x: 50, y: 40 })).toBeNull();
  });

  it("hits a vertex and keeps that sample's stats", () => {
    const hit = hitReviewTrack(map, LINE, { x: 2, y: 1 });
    expect(hit).not.toBeNull();
    expect(hit!.index).toBe(0);
    expect(hit!.timeMs).toBe(1_000);
    expect(hit!.speedMps).toBe(4);
    expect(hit!.onFoil).toBe(false);
  });

  it("snaps to the nearer vertex and interpolates the marker", () => {
    const hit = hitReviewTrack(map, LINE, { x: 70, y: 4 });
    expect(hit).not.toBeNull();
    expect(hit!.index).toBe(1);
    expect(hit!.timeMs).toBe(2_000);
    expect(hit!.onFoil).toBe(true);
    expect(hit!.markerLon).toBeCloseTo(70, 5);
    expect(hit!.markerLat).toBeCloseTo(0, 5);
  });

  it("hits the second segment", () => {
    const hit = hitReviewTrack(map, LINE, { x: 103, y: 25 });
    expect(hit).not.toBeNull();
    expect(hit!.index).toBe(2);
    expect(hit!.markerLon).toBeCloseTo(100, 5);
    expect(hit!.markerLat).toBeCloseTo(25, 5);
  });
});

describe("reviewPolylinePoints", () => {
  it("prefers foil overlay vertices when they exist", () => {
    const overlay: ReviewFoilOverlay = {
      points: LINE,
      events: [],
    };
    const track = {
      points: [{ lon: 9, lat: 9, time: null, timeMs: null }],
    } as GpxTrack;
    expect(reviewPolylinePoints(overlay, track)).toBe(LINE);
  });

  it("falls back to the GPX track", () => {
    const track = {
      points: [
        { lon: 1, lat: 2, time: null, timeMs: null },
        { lon: 3, lat: 4, time: null, timeMs: null },
      ],
    } as GpxTrack;
    expect(reviewPolylinePoints(null, track)).toEqual(track.points);
  });
});

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

function alongTrack(stepM: number, count: number) {
  const points = [];
  let lat = 53.03;
  let lon = -114.06;
  for (let i = 0; i < count; i++) {
    points.push({
      lon,
      lat,
      timeMs: 1_000 + i * 1_000,
      onFoil: true,
    });
    const next = dest(lat, lon, 0, stepM);
    lat = next.lat;
    lon = next.lon;
  }
  return points;
}

function sliceLengthM(
  points: Array<{ lon: number; lat: number }>,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    sum += 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  return sum;
}

describe("track focus window", () => {
  const points = alongTrack(50, 61);

  it("keeps 100 m behind and 500 m ahead of the cursor", () => {
    const cursor = points[30]!;
    const range = reviewFocusRange(points, cursor);
    expect(range).not.toBeNull();
    expect(range!.focusIndex).toBe(30);
    const before = sliceLengthM(points.slice(range!.startIndex, range!.focusIndex + 1));
    const after = sliceLengthM(points.slice(range!.focusIndex, range!.endIndex + 1));
    expect(before).toBeLessThanOrEqual(TRACK_PAST_FOCUS_M + 1);
    expect(after).toBeLessThanOrEqual(TRACK_FOCUS_M + 1);
    expect(before).toBeGreaterThan(TRACK_PAST_FOCUS_M - 50);
    expect(after).toBeGreaterThan(TRACK_FOCUS_M - 50);
    if (range!.startIndex > 0) {
      expect(
        sliceLengthM(points.slice(range!.startIndex - 1, range!.focusIndex + 1)),
      ).toBeGreaterThan(TRACK_PAST_FOCUS_M);
    }
  });

  it("slices 100 m past plus 500 m future around a mid-track cursor", () => {
    const cursor = points[30]!;
    const slice = sliceTrackFocus(points, cursor);
    expect(slice).not.toBeNull();
    expect(sliceLengthM(slice!)).toBeCloseTo(
      TRACK_PAST_FOCUS_M + TRACK_FOCUS_M,
      0,
    );
  });

  it("clips the window at the start of the track", () => {
    const slice = sliceTrackFocus(points, points[0]!);
    expect(slice).not.toBeNull();
    expect(sliceLengthM(slice!)).toBeCloseTo(TRACK_FOCUS_M, 0);
    expect(slice![0]!.lon).toBeCloseTo(points[0]!.lon, 6);
    expect(slice![0]!.lat).toBeCloseTo(points[0]!.lat, 6);
  });

  it("clips the window at the end of the track", () => {
    const slice = sliceTrackFocus(points, points[points.length - 1]!);
    expect(slice).not.toBeNull();
    expect(sliceLengthM(slice!)).toBeCloseTo(TRACK_PAST_FOCUS_M, 0);
  });

  it("prefers the current lap when the track doubles back", () => {
    const out = alongTrack(25, 80);
    const back = [...out].reverse().slice(1).map((p, i) => ({
      ...p,
      timeMs: out[out.length - 1]!.timeMs + (i + 1) * 1_000,
    }));
    const doubled = [...out, ...back];
    const cursor = doubled[20]!;
    const range = reviewFocusRange(doubled, cursor);
    expect(range!.endIndex).toBeLessThan(out.length);
    const mid = {
      x: (out[0]!.lon + out[out.length - 1]!.lon) / 2,
      y: (out[0]!.lat + out[out.length - 1]!.lat) / 2,
    };
    const hit = hitReviewTrack(map, doubled, mid, 20, range);
    expect(hit).not.toBeNull();
    expect(hit!.index).toBeLessThan(out.length);
  });
});

describe("trackFocusAlpha", () => {
  it("stays fully bright through the 500 m future core", () => {
    expect(trackFocusAlpha(0)).toBe(1);
    expect(trackFocusAlpha(TRACK_FOCUS_M)).toBe(1);
  });

  it("stays fully bright through the 100 m past core", () => {
    expect(trackFocusAlpha(-TRACK_PAST_FOCUS_M)).toBe(1);
    expect(trackFocusAlpha(-TRACK_PAST_FOCUS_M - 1)).toBeLessThan(1);
  });

  it("eases toward the ghost over the future fade span", () => {
    const mid = trackFocusAlpha(TRACK_FOCUS_M + TRACK_FADE_SPAN_M / 2);
    const end = trackFocusAlpha(TRACK_FOCUS_M + TRACK_FADE_SPAN_M);
    const far = trackFocusAlpha(TRACK_FOCUS_M + TRACK_FADE_SPAN_M * 3);
    expect(mid).toBeGreaterThan(end);
    expect(mid).toBeLessThan(1);
    expect(end).toBeCloseTo(0.16, 2);
    expect(far).toBeCloseTo(0.16, 2);
  });

  it("eases toward the ghost over 100 m behind the past core", () => {
    const mid = trackFocusAlpha(
      -(TRACK_PAST_FOCUS_M + TRACK_PAST_FADE_SPAN_M / 2),
    );
    const end = trackFocusAlpha(
      -(TRACK_PAST_FOCUS_M + TRACK_PAST_FADE_SPAN_M),
    );
    const far = trackFocusAlpha(
      -(TRACK_PAST_FOCUS_M + TRACK_PAST_FADE_SPAN_M * 3),
    );
    expect(mid).toBeGreaterThan(end);
    expect(mid).toBeLessThan(1);
    expect(end).toBeCloseTo(0.16, 2);
    expect(far).toBeCloseTo(0.16, 2);
  });
});

describe("trackSpeedColorCss", () => {
  it("maps missing speed to a muted gray", () => {
    expect(trackSpeedColorCss(null)).toBe("rgba(90, 96, 100, 0.75)");
    expect(trackSpeedColorCss(Number.NaN)).toBe("rgba(90, 96, 100, 0.75)");
  });

  it("uses the thermal ramp from 0 kt blue to 25 kt red", () => {
    const kt = (n: number) => n / 1.94384;
    expect(trackSpeedColorCss(0)).toBe("rgb(12,51,131)");
    expect(trackSpeedColorCss(kt(25))).toBe("rgb(217,30,30)");
    expect(trackSpeedColorCss(kt(40))).toBe("rgb(217,30,30)");
    const slow = trackSpeedColorCss(kt(8));
    const mid = trackSpeedColorCss(kt(16));
    expect(slow).not.toBe(mid);
    expect(mid).not.toBe(trackSpeedColorCss(kt(25)));
  });
});

