import type { Map as MapLibreMap } from "maplibre-gl";
import { DEFAULT_WIND_SCALE, sampleRgb } from "./colorScales";
import type { GpxTrack } from "./gpx";

export type ReviewCursor = {
  lon: number;
  lat: number;
  headingDeg?: number | null;
  timeMs?: number | null;
};

export type ReviewWindTick = {
  lon: number;
  lat: number;
  windDirDeg: number;
};

export type ReviewFoilEvent = {
  lon: number;
  lat: number;
  timeMs: number;
  kind: "tack" | "jibe" | "transition" | "fall";
  success: boolean;
  label: string;
};

/** Along-track sample used for speed coloring and hover stats. */
export type ReviewTrackPoint = {
  lon: number;
  lat: number;
  onFoil?: boolean;
  timeMs?: number | null;
  speedMps?: number | null;
  headingDeg?: number | null;
  windDirDeg?: number | null;
  windSpeedMps?: number | null;
  gustMps?: number | null;
  hsM?: number | null;
  pointDeg?: number | null;
};

export type ReviewFoilOverlay = {
  points: ReviewTrackPoint[];
  events: ReviewFoilEvent[];
  trackGeojson?: GeoJSON.FeatureCollection | null;
  eventGeojson?: GeoJSON.FeatureCollection | null;
};

export type ReviewTrackHit<T extends { lon: number; lat: number } = ReviewTrackPoint> =
  T & {
    index: number;
    markerLon: number;
    markerLat: number;
  };

export type ReviewFocusRange = {
  startIndex: number;
  endIndex: number;
  focusIndex: number;
};

const TRACK_LINE_WIDTH = 3.2;
const SPEED_COLOR_STEPS = 16;
/** Board-speed color ramp spans 0–25 kt; faster clips to the top stop. */
export const TRACK_SPEED_MAX_KT = 25;
export const TRACK_SPEED_MAX_MPS = TRACK_SPEED_MAX_KT / 1.94384;
const MISSING_SPEED_CSS = "rgba(90, 96, 100, 0.75)";
const EVENT_HIT_PX = 14;
const TRACK_HIT_PX = 12;
/** Fully visible along-track radius ahead of the current point. */
export const TRACK_FOCUS_M = 500;
/** Extra future distance over which opacity eases to the ghost. */
export const TRACK_FADE_SPAN_M = 500;
/** Fully visible along-track radius behind the current point. */
export const TRACK_PAST_FOCUS_M = 100;
/** Extra past distance over which opacity eases to the ghost. */
export const TRACK_PAST_FADE_SPAN_M = 100;
const TRACK_FADE_ALPHA = 0.16;

/** Stroke color for board speed, using the thermal ramp compressed to 0–25 kt. */
export function trackSpeedColorCss(
  speedMps: number | null | undefined,
): string {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps < 0) {
    return MISSING_SPEED_CSS;
  }
  const t = Math.max(0, Math.min(1, speedMps / TRACK_SPEED_MAX_MPS));
  const [r, g, b] = sampleRgb(DEFAULT_WIND_SCALE, t);
  return `rgb(${r},${g},${b})`;
}

const PERP_TICK_HALF_M = 90;
const PERP_TICK_ACTIVE_HALF_M = 150;
const TRAVEL_SHAFT_PX = 16;

function destinationLngLat(
  lon: number,
  lat: number,
  distanceM: number,
  bearingDeg: number,
): [number, number] {
  const R = 6371000;
  const δ = distanceM / R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);
  const φ2 = Math.asin(sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(θ) * sinδ * cosφ1, cosδ - sinφ1 * Math.sin(φ2));
  return [((λ2 * 180) / Math.PI + 540) % 360 - 180, (φ2 * 180) / Math.PI];
}

function strokeLine(
  ctx: CanvasRenderingContext2D,
  map: Pick<MapLibreMap, "project">,
  coords: GeoJSON.Position[],
): boolean {
  if (coords.length < 2) return false;
  ctx.beginPath();
  let started = false;
  for (const pos of coords) {
    const lon = pos[0];
    const lat = pos[1];
    if (lon == null || lat == null) continue;
    const p = map.project([lon, lat]);
    if (!started) {
      ctx.moveTo(p.x, p.y);
      started = true;
    } else {
      ctx.lineTo(p.x, p.y);
    }
  }
  if (!started) return false;
  ctx.stroke();
  return true;
}

function drawDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string,
  stroke: string,
  strokeW: number,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = strokeW;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

function drawTravelHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  headingDeg: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((headingDeg * Math.PI) / 180);
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5.2, 5.5);
  ctx.lineTo(-5.2, 5.5);
  ctx.closePath();
  ctx.fillStyle = "#c45c1a";
  ctx.strokeStyle = "rgba(248, 246, 240, 0.95)";
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

type MapProject = {
  project: (lngLat: [number, number]) => { x: number; y: number };
};

/** Vertices of the painted review track, for hit-testing. */
export function reviewPolylinePoints(
  overlay: ReviewFoilOverlay | null | undefined,
  track: GpxTrack | null | undefined,
): ReviewTrackPoint[] {
  if (overlay && overlay.points.length >= 2) return overlay.points;
  if (track && track.points.length >= 2) return track.points;
  return [];
}

export function reviewFocusRange(
  points: readonly ReviewTrackPoint[] | null | undefined,
  cursor: ReviewCursor | null | undefined,
  futureRadiusM = TRACK_FOCUS_M,
  pastRadiusM = TRACK_PAST_FOCUS_M,
): ReviewFocusRange | null {
  if (!points || points.length < 2 || !cursor) return null;
  const cum = cumulativeDistanceM(points);
  const focusIndex = focusIndexForCursor(points, cursor);
  const focusD = cum[focusIndex]!;
  let startIndex = focusIndex;
  while (startIndex > 0 && focusD - cum[startIndex - 1]! <= pastRadiusM) {
    startIndex -= 1;
  }
  let endIndex = focusIndex;
  while (
    endIndex < points.length - 1 &&
    cum[endIndex + 1]! - focusD <= futureRadiusM
  ) {
    endIndex += 1;
  }
  return { startIndex, endIndex, focusIndex };
}

/** Bright slice of the track around the cursor (100 m past, 500 m future). */
export function sliceTrackFocus(
  points: readonly ReviewTrackPoint[],
  cursor: ReviewCursor | null | undefined,
  futureRadiusM = TRACK_FOCUS_M,
  pastRadiusM = TRACK_PAST_FOCUS_M,
): ReviewTrackPoint[] | null {
  if (points.length < 2 || !cursor) return null;
  const cum = cumulativeDistanceM(points);
  const focusIndex = focusIndexForCursor(points, cursor);
  const focusD = cum[focusIndex]!;
  const startD = Math.max(0, focusD - pastRadiusM);
  const endD = Math.min(cum[cum.length - 1]!, focusD + futureRadiusM);
  const out: ReviewTrackPoint[] = [];
  for (let i = 1; i < points.length; i++) {
    const d0 = cum[i - 1]!;
    const d1 = cum[i]!;
    if (d1 < startD || d0 > endD) continue;
    const a = points[i - 1]!;
    const b = points[i]!;
    const span = d1 - d0;
    if (out.length === 0) {
      out.push(
        span > 0 && d0 < startD ? lerpTrackPoint(a, b, (startD - d0) / span) : a,
      );
    }
    if (d1 <= endD) {
      out.push(b);
    } else {
      out.push(span > 0 ? lerpTrackPoint(a, b, (endD - d0) / span) : b);
      break;
    }
  }
  return out.length >= 2 ? out : [points[focusIndex]!];
}

function cumulativeDistanceM(
  points: readonly { lon: number; lat: number }[],
): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1]! + haversineM(points[i - 1]!, points[i]!));
  }
  return cum;
}

function focusIndexForCursor(
  points: readonly ReviewTrackPoint[],
  cursor: ReviewCursor,
): number {
  if (cursor.timeMs != null && Number.isFinite(cursor.timeMs)) {
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < points.length; i++) {
      const t = points[i]!.timeMs;
      if (t == null || !Number.isFinite(t)) continue;
      const d = Math.abs(t - cursor.timeMs);
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    }
    if (bestDiff < Infinity) return best;
  }
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = haversineM(points[i]!, cursor);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function lerpTrackPoint(
  a: ReviewTrackPoint,
  b: ReviewTrackPoint,
  t: number,
): ReviewTrackPoint {
  const u = Math.max(0, Math.min(1, t));
  const aTime = a.timeMs;
  const bTime = b.timeMs;
  return {
    ...a,
    lon: a.lon + (b.lon - a.lon) * u,
    lat: a.lat + (b.lat - a.lat) * u,
    timeMs:
      aTime != null && bTime != null && Number.isFinite(aTime) && Number.isFinite(bTime)
        ? aTime + (bTime - aTime) * u
        : aTime,
  };
}

function haversineM(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Opacity for a point `signedDistM` along-track from the cursor.
 * Negative is past (100 m core + 100 m fade); positive is future (500 m + 500 m).
 */
export function trackFocusAlpha(signedDistM: number): number {
  const distM = Math.abs(signedDistM);
  const focusM = signedDistM < 0 ? TRACK_PAST_FOCUS_M : TRACK_FOCUS_M;
  const fadeM = signedDistM < 0 ? TRACK_PAST_FADE_SPAN_M : TRACK_FADE_SPAN_M;
  const t = smoothstep(focusM, focusM + fadeM, distM);
  return 1 + (TRACK_FADE_ALPHA - 1) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function overlayFocusAlpha(alpha: number): number {
  const span = 1 - TRACK_FADE_ALPHA;
  if (span <= 1e-6) return alpha >= 1 ? 1 : 0;
  return Math.max(0, (alpha - TRACK_FADE_ALPHA) / span);
}

export function hitReviewTrack<T extends { lon: number; lat: number }>(
  map: MapProject,
  points: readonly T[] | null | undefined,
  screen: { x: number; y: number },
  hitPx = TRACK_HIT_PX,
  prefer?: ReviewFocusRange | null,
): ReviewTrackHit<T> | null {
  if (!points || points.length < 2) return null;
  const preferHit = prefer
    ? hitTrackRange(map, points, screen, hitPx, prefer.startIndex, prefer.endIndex)
    : null;
  if (preferHit) return preferHit;
  return hitTrackRange(map, points, screen, hitPx, 0, points.length - 1);
}

function hitTrackRange<T extends { lon: number; lat: number }>(
  map: MapProject,
  points: readonly T[],
  screen: { x: number; y: number },
  hitPx: number,
  startIndex: number,
  endIndex: number,
): ReviewTrackHit<T> | null {
  if (endIndex <= startIndex) return null;
  const maxD = hitPx * hitPx;
  let bestD = maxD;
  let best: ReviewTrackHit<T> | null = null;
  let prev = map.project([points[startIndex]!.lon, points[startIndex]!.lat]);
  for (let i = startIndex + 1; i <= endIndex; i++) {
    const cur = points[i]!;
    const p = map.project([cur.lon, cur.lat]);
    const hit = closestOnSegment(screen.x, screen.y, prev.x, prev.y, p.x, p.y);
    if (hit.dist2 <= bestD) {
      bestD = hit.dist2;
      const a = points[i - 1]!;
      const t = hit.t;
      best = {
        ...(t < 0.5 ? a : cur),
        index: t < 0.5 ? i - 1 : i,
        markerLon: a.lon + t * (cur.lon - a.lon),
        markerLat: a.lat + t * (cur.lat - a.lat),
      };
    }
    prev = p;
  }
  return best;
}

function closestOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { t: number; dist2: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  const t =
    len2 <= 1e-12
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  const x = ax + t * abx;
  const y = ay + t * aby;
  const dx = px - x;
  const dy = py - y;
  return { t, dist2: dx * dx + dy * dy };
}

export function hitReviewFoilEvent(
  map: MapProject,
  overlay: ReviewFoilOverlay | null | undefined,
  point: { x: number; y: number },
): ReviewFoilEvent | null {
  if (!overlay || overlay.events.length === 0) return null;
  let best: ReviewFoilEvent | null = null;
  let bestD = EVENT_HIT_PX * EVENT_HIT_PX;
  for (const ev of overlay.events) {
    const p = map.project([ev.lon, ev.lat]);
    const dx = p.x - point.x;
    const dy = p.y - point.y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = ev;
    }
  }
  return best;
}

/**
 * Screen-space review track so it cannot sit under MapLibre canvas heatmaps
 * (those rasters composite above vector layers).
 */
export function drawReviewPath(
  canvas: HTMLCanvasElement,
  map: Pick<MapLibreMap, "project">,
  track: GpxTrack | null | undefined,
  cursor?: ReviewCursor | null,
  windTicks?: ReviewWindTick[] | null,
  windTickIndex?: number | null,
  foil?: ReviewFoilOverlay | null,
  hover?: ReviewCursor | null,
): void {
  const wrap = canvas.parentElement;
  const cssW = wrap?.clientWidth || canvas.clientWidth;
  const cssH = wrap?.clientHeight || canvas.clientHeight;
  if (cssW < 2 || cssH < 2) return;
  const dpr = Math.min(
    2,
    (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1,
  );
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  if (!track) return;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (windTicks && windTicks.length > 0) {
    for (let i = 0; i < windTicks.length; i++) {
      const t = windTicks[i]!;
      const active = windTickIndex != null && i === windTickIndex;
      const half = active ? PERP_TICK_ACTIVE_HALF_M : PERP_TICK_HALF_M;
      const a = destinationLngLat(t.lon, t.lat, half, t.windDirDeg + 90);
      const b = destinationLngLat(t.lon, t.lat, half, t.windDirDeg - 90);
      ctx.setLineDash(active ? [1, 1.15] : [0.7, 1.35]);
      ctx.strokeStyle = "#1f6f78";
      ctx.globalAlpha = active ? 0.95 : 0.55;
      ctx.lineWidth = active ? 2.1 : 1.35;
      strokeLine(ctx, map, [a, b]);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  const poly = reviewPolylinePoints(foil, track);
  const focus =
    cursor && poly.length >= 2
      ? {
          index: focusIndexForCursor(poly, cursor),
          cum: cumulativeDistanceM(poly),
        }
      : null;
  if (poly.length >= 2) {
    if (focus) {
      drawTrackFocusFade(ctx, map, poly, focus.cum, focus.cum[focus.index]!);
    } else {
      drawTrackBody(ctx, map, poly, 1);
    }
  } else {
    for (const f of track.geojson.features) {
      const kind = f.properties?.kind;
      if (kind !== "track" && kind !== "route") continue;
      if (f.geometry.type !== "LineString") continue;
      ctx.strokeStyle = MISSING_SPEED_CSS;
      ctx.lineWidth = TRACK_LINE_WIDTH;
      strokeLine(ctx, map, f.geometry.coordinates);
    }
  }

  for (const f of track.geojson.features) {
    const kind = f.properties?.kind;
    if (kind !== "start" && kind !== "end") continue;
    if (f.geometry.type !== "Point") continue;
    const lon = f.geometry.coordinates[0];
    const lat = f.geometry.coordinates[1];
    if (lon == null || lat == null) continue;
    const p = map.project([lon, lat]);
    if (p.x < -12 || p.y < -12 || p.x > cssW + 12 || p.y > cssH + 12) continue;
    if (kind === "start") {
      drawDot(ctx, p.x, p.y, 5.5, "#1f6f78", "#f8f6f0", 2);
    } else {
      drawDot(ctx, p.x, p.y, 4.5, "#c45c1a", "#f8f6f0", 2);
    }
  }

  if (foil) {
    const cum = focus?.cum;
    const focusD = focus ? focus.cum[focus.index]! : 0;
    for (const ev of foil.events) {
      const p = map.project([ev.lon, ev.lat]);
      if (p.x < -16 || p.y < -16 || p.x > cssW + 16 || p.y > cssH + 16) continue;
      if (cum) {
        const idx = eventFocusIndex(poly, ev.timeMs);
        ctx.globalAlpha = trackFocusAlpha(cum[idx]! - focusD);
      }
      drawFoilEvent(ctx, p.x, p.y, ev);
      ctx.globalAlpha = 1;
    }
  }

  if (
    hover &&
    Number.isFinite(hover.lon) &&
    Number.isFinite(hover.lat)
  ) {
    const p = map.project([hover.lon, hover.lat]);
    drawDot(ctx, p.x, p.y, 7, "rgba(248, 246, 240, 0.92)", "#1f6f78", 1.6);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = "#1f6f78";
    ctx.fill();
  }

  if (
    cursor &&
    Number.isFinite(cursor.lon) &&
    Number.isFinite(cursor.lat)
  ) {
    const p = map.project([cursor.lon, cursor.lat]);
    const heading = cursor.headingDeg;
    if (heading != null && Number.isFinite(heading)) {
      const rad = (heading * Math.PI) / 180;
      const tipX = p.x + Math.sin(rad) * TRAVEL_SHAFT_PX;
      const tipY = p.y - Math.cos(rad) * TRAVEL_SHAFT_PX;
      ctx.strokeStyle = "rgba(196, 92, 26, 0.95)";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      drawTravelHead(ctx, tipX, tipY, heading);
    }
    drawDot(ctx, p.x, p.y, 10, "rgba(248, 246, 240, 0.92)", "#1c201e", 1.5);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = "#c45c1a";
    ctx.fill();
  }
}

function drawTrackBody(
  ctx: CanvasRenderingContext2D,
  map: Pick<MapLibreMap, "project">,
  points: ReviewTrackPoint[],
  alpha: number,
): void {
  if (points.length < 2) return;
  ctx.globalAlpha = alpha;
  strokeSpeedRuns(ctx, map, points);
  ctx.globalAlpha = 1;
}

function drawTrackFocusFade(
  ctx: CanvasRenderingContext2D,
  map: Pick<MapLibreMap, "project">,
  points: ReviewTrackPoint[],
  cum: number[],
  focusD: number,
): void {
  drawTrackBody(ctx, map, points, TRACK_FADE_ALPHA);

  const segAlpha: number[] = new Array(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    const dist = (cum[i - 1]! + cum[i]!) / 2 - focusD;
    segAlpha[i] = quantizeOverlayAlpha(
      overlayFocusAlpha(trackFocusAlpha(dist)),
    );
  }
  const levels = [...new Set(segAlpha.filter((a) => a > 0))].sort(
    (a, b) => a - b,
  );

  for (const level of levels) {
    ctx.globalAlpha = level;
    strokeSpeedRuns(ctx, map, points, (i) => segAlpha[i] === level);
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = "round";
}

function strokeSpeedRuns(
  ctx: CanvasRenderingContext2D,
  map: Pick<MapLibreMap, "project">,
  points: ReviewTrackPoint[],
  include?: (segIndex: number) => boolean,
): void {
  ctx.lineCap = "butt";
  ctx.lineJoin = "bevel";
  ctx.lineWidth = TRACK_LINE_WIDTH;
  let i = 1;
  while (i < points.length) {
    if (include && !include(i)) {
      i += 1;
      continue;
    }
    const key = speedColorKey(segmentSpeedMps(points, i));
    const coords: [number, number][] = [
      [points[i - 1]!.lon, points[i - 1]!.lat],
    ];
    let j = i;
    while (
      j < points.length &&
      (!include || include(j)) &&
      speedColorKey(segmentSpeedMps(points, j)) === key
    ) {
      coords.push([points[j]!.lon, points[j]!.lat]);
      j += 1;
    }
    ctx.strokeStyle = trackSpeedColorCss(segmentSpeedMps(points, i));
    strokeLine(ctx, map, coords);
    i = j;
  }
}

function speedColorKey(speedMps: number | null): number {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps < 0) return -1;
  return Math.round(
    Math.max(0, Math.min(1, speedMps / TRACK_SPEED_MAX_MPS)) * SPEED_COLOR_STEPS,
  );
}

function segmentSpeedMps(
  points: ReviewTrackPoint[],
  endIndex: number,
): number | null {
  const a = pointSpeedMps(points, endIndex - 1);
  const b = pointSpeedMps(points, endIndex);
  if (a != null && b != null) return (a + b) / 2;
  return a ?? b;
}

function pointSpeedMps(
  points: ReviewTrackPoint[],
  i: number,
): number | null {
  const p = points[i];
  if (!p) return null;
  if (p.speedMps != null && Number.isFinite(p.speedMps)) return p.speedMps;
  const t = p.timeMs;
  if (t == null || !Number.isFinite(t)) return null;
  const prev = i > 0 ? points[i - 1]! : null;
  const next = i < points.length - 1 ? points[i + 1]! : null;
  const a = prev?.timeMs != null && Number.isFinite(prev.timeMs) ? prev : null;
  const b = next?.timeMs != null && Number.isFinite(next.timeMs) ? next : null;
  if (a && b && a.timeMs != null && b.timeMs != null && b.timeMs !== a.timeMs) {
    return haversineM(a, b) / (Math.abs(b.timeMs - a.timeMs) / 1000);
  }
  if (a && a.timeMs != null && a.timeMs !== t) {
    return haversineM(a, p) / (Math.abs(t - a.timeMs) / 1000);
  }
  if (b && b.timeMs != null && b.timeMs !== t) {
    return haversineM(p, b) / (Math.abs(b.timeMs - t) / 1000);
  }
  return null;
}

const OVERLAY_ALPHA_STEPS = 10;

function quantizeOverlayAlpha(alpha: number): number {
  if (alpha <= 0.01) return 0;
  return Math.max(
    1 / OVERLAY_ALPHA_STEPS,
    Math.round(alpha * OVERLAY_ALPHA_STEPS) / OVERLAY_ALPHA_STEPS,
  );
}

function eventFocusIndex(
  points: readonly ReviewTrackPoint[],
  timeMs: number,
): number {
  return focusIndexForCursor(points, { lon: 0, lat: 0, timeMs });
}

function drawFoilEvent(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ev: ReviewFoilEvent,
): void {
  const made = ev.success;
  const fill =
    ev.kind === "fall" ? "#a03030" : made ? "#1f6f78" : "#a04814";
  drawDot(ctx, x, y, ev.kind === "fall" ? 5.5 : 6.2, fill, "#f8f6f0", 1.6);
  const mark =
    ev.kind === "tack" ? "T" : ev.kind === "jibe" ? "J" : ev.kind === "fall" ? "×" : "↻";
  ctx.fillStyle = "#f8f6f0";
  ctx.font = "bold 8px 'IBM Plex Sans', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(mark, x, y + (ev.kind === "fall" ? 0.5 : 0.4));
}
