import type { GpxPoint, GpxTrack } from "./gpx";
import { pointAngleFromPerp, wrap180 } from "./sessionTrack";
import { nearestHourIndex, type WindHour } from "./wind";

const KT = 0.514444;
const REACH_DEG = 30;
const MEDIAN_WINDOW = 5;
const EMA_ALPHA = 0.35;

export type FoilThresholds = {
  takeoffMps: number;
  landingMps: number;
  fallMps: number;
  minHeadingSpeedMps: number;
  takeoffHoldSec: number;
  landingHoldSec: number;
  mergeGapSec: number;
  fallWindowSec: number;
  maneuverMinTurnDeg: number;
  maneuverWindowSec: number;
  maneuverMaxDurationSec: number;
  maneuverMinRateDps: number;
  maneuverEndRateDps: number;
  maneuverMinDurationSec: number;
  maneuverStabilizeSec: number;
  maneuverStabilizeDeg: number;
  maneuverEntryHoldSec: number;
  maneuverCooldownSec: number;
  maneuverMaxGapSec: number;
  maneuverMaxStepDeg: number;
  headingBaselineSec: number;
  maxPlausibleMps: number;
  maxGapSec: number;
};

export const DEFAULT_FOIL_THRESHOLDS: FoilThresholds = {
  takeoffMps: 5.5 * KT,
  landingMps: 3.8 * KT,
  fallMps: 1.0 * KT,
  minHeadingSpeedMps: 1.5 * KT,
  takeoffHoldSec: 3,
  landingHoldSec: 2,
  mergeGapSec: 4,
  fallWindowSec: 4,
  maneuverMinTurnDeg: 100,
  maneuverWindowSec: 8,
  maneuverMaxDurationSec: 12,
  maneuverMinRateDps: 15,
  maneuverEndRateDps: 8,
  maneuverMinDurationSec: 2,
  maneuverStabilizeSec: 3,
  maneuverStabilizeDeg: 35,
  maneuverEntryHoldSec: 2,
  maneuverCooldownSec: 8,
  maneuverMaxGapSec: 3,
  maneuverMaxStepDeg: 80,
  headingBaselineSec: 3,
  maxPlausibleMps: 20,
  maxGapSec: 8,
};

/** Bump when maneuver rules change so review mode recomputes a memoized analysis. */
export const FOIL_ANALYSIS_REVISION = 6;

const TAKEOFF_STORAGE_KEY = "chop.foilTakeoffMps";
const TAKEOFF_MIN_MPS = 1.5;
const TAKEOFF_MAX_MPS = 8;

export type FoilPoint = {
  index: number;
  timeMs: number;
  lon: number;
  lat: number;
  speedMps: number;
  speedSmoothMps: number;
  headingDeg: number | null;
  onFoil: boolean;
  windDirDeg: number | null;
};

export type FoilSegment = {
  startIndex: number;
  endIndex: number;
  startTimeMs: number;
  endTimeMs: number;
  durationSec: number;
  distanceM: number;
  endKind: "fall" | "touchdown" | "session-end";
};

export type ManeuverType = "tack" | "jibe" | "transition";
export type ManeuverSide = "port" | "starboard";

export type Maneuver = {
  type: ManeuverType;
  side: ManeuverSide;
  success: boolean;
  timeMs: number;
  lon: number;
  lat: number;
  index: number;
  startIndex: number;
  endIndex: number;
  turnDeg: number;
};

export type FoilEventKind = ManeuverType | "fall";

export type FoilEvent = {
  kind: FoilEventKind;
  success: boolean;
  timeMs: number;
  lon: number;
  lat: number;
  index: number;
  side?: ManeuverSide;
  turnDeg?: number;
  label: string;
};

export type ManeuverBucket = {
  attempted: number;
  made: number;
  port: { attempted: number; made: number };
  starboard: { attempted: number; made: number };
};

export type SessionStats = {
  totalDurationSec: number;
  totalDistanceM: number;
  foilDurationSec: number;
  foilDistanceM: number;
  foilTimePct: number;
  foilDistancePct: number;
  flightCount: number;
  longestFlightSec: number;
  longestFlightM: number;
  timeToFirstFlightSec: number | null;
  tacks: ManeuverBucket;
  jibes: ManeuverBucket;
  transitions: ManeuverBucket;
  falls: number;
  touchdowns: number;
  maxSpeedMps: number | null;
  avgFoilSpeedMps: number | null;
  best5sMps: number | null;
  best100mMps: number | null;
  best500mMps: number | null;
  upwindDistanceM: number;
  downwindDistanceM: number;
  reachingDistanceM: number;
  bestUpwindAngleDeg: number | null;
  bestDownwindAngleDeg: number | null;
  hasWind: boolean;
};

export type FoilAnalysis = {
  points: FoilPoint[];
  segments: FoilSegment[];
  maneuvers: Maneuver[];
  events: FoilEvent[];
  stats: SessionStats;
  trackGeojson: GeoJSON.FeatureCollection;
  eventGeojson: GeoJSON.FeatureCollection;
  thresholds: FoilThresholds;
};

export function resolveFoilThresholds(
  partial?: Partial<FoilThresholds>,
): FoilThresholds {
  const takeoff = clamp(
    partial?.takeoffMps ?? DEFAULT_FOIL_THRESHOLDS.takeoffMps,
    TAKEOFF_MIN_MPS,
    TAKEOFF_MAX_MPS,
  );
  const landing =
    partial?.landingMps ??
    takeoff *
      (DEFAULT_FOIL_THRESHOLDS.landingMps / DEFAULT_FOIL_THRESHOLDS.takeoffMps);
  return {
    ...DEFAULT_FOIL_THRESHOLDS,
    ...partial,
    takeoffMps: takeoff,
    landingMps: landing,
  };
}

export function loadFoilTakeoffMps(): number {
  try {
    const raw = localStorage.getItem(TAKEOFF_STORAGE_KEY);
    if (!raw) return DEFAULT_FOIL_THRESHOLDS.takeoffMps;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_FOIL_THRESHOLDS.takeoffMps;
    return clamp(n, TAKEOFF_MIN_MPS, TAKEOFF_MAX_MPS);
  } catch {
    return DEFAULT_FOIL_THRESHOLDS.takeoffMps;
  }
}

export function saveFoilTakeoffMps(mps: number): void {
  try {
    localStorage.setItem(
      TAKEOFF_STORAGE_KEY,
      String(clamp(mps, TAKEOFF_MIN_MPS, TAKEOFF_MAX_MPS)),
    );
  } catch {
    // ignore quota / private mode
  }
}

export function nearestIndexByTime(
  items: Array<{ timeMs: number }>,
  timeMs: number,
): number {
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < items.length; i++) {
    const d = Math.abs(items[i]!.timeMs - timeMs);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

/** Infer foil / maneuver stats from a timed GPS track. */
export function analyzeFoilSession(
  track: GpxTrack,
  hours?: WindHour[] | null,
  partialThresholds?: Partial<FoilThresholds>,
): FoilAnalysis | null {
  const thresholds = resolveFoilThresholds(partialThresholds);
  const timed = track.points.filter(
    (p): p is GpxPoint & { time: string; timeMs: number } =>
      p.time != null && p.timeMs != null && Number.isFinite(p.timeMs),
  );
  if (timed.length < 2) return null;

  const hasWind = !!hours && hours.length > 0;
  const rawSpeed = timed.map((_, i) => rawSpeedAt(timed, i, thresholds.maxPlausibleMps));
  const medianSpeed = rollingMedian(rawSpeed, MEDIAN_WINDOW);
  const smoothSpeed = ema(medianSpeed, EMA_ALPHA);

  const headings = timed.map((_, i) =>
    headingAt(timed, i, thresholds.headingBaselineSec, smoothSpeed[i]!, thresholds.minHeadingSpeedMps),
  );

  const onFoil = detectOnFoil(timed, smoothSpeed, thresholds);
  // Falls use recorded/derived speed. Median+EMA lag hides a stop that
  // Strava velocity_smooth (or GPX speed) already shows.
  const segments = buildSegments(timed, rawSpeed, onFoil, thresholds);
  applyOnFoilFromSegments(onFoil, segments);

  const points: FoilPoint[] = timed.map((p, i) => ({
    index: i,
    timeMs: p.timeMs,
    lon: p.lon,
    lat: p.lat,
    speedMps: rawSpeed[i]!,
    speedSmoothMps: smoothSpeed[i]!,
    headingDeg: headings[i]!,
    onFoil: onFoil[i]!,
    windDirDeg: hasWind ? hours[nearestHourIndex(hours, p.timeMs)]!.windDirDeg : null,
  }));

  const maneuvers = detectManeuvers(points, thresholds, hasWind);
  const events = buildEvents(points, segments, maneuvers);
  const stats = aggregateStats(points, segments, maneuvers, hasWind);
  const trackGeojson = buildTrackGeojson(points, track);
  const eventGeojson = buildEventGeojson(events);

  return {
    points,
    segments,
    maneuvers,
    events,
    stats,
    trackGeojson,
    eventGeojson,
    thresholds,
  };
}

function rawSpeedAt(
  points: Array<GpxPoint & { timeMs: number }>,
  i: number,
  maxMps: number,
): number {
  const recorded = points[i]!.speedMps;
  if (recorded != null && Number.isFinite(recorded) && recorded >= 0) {
    return recorded > maxMps ? 0 : recorded;
  }
  const derived = speedFromNeighbors(points, i);
  if (derived == null || !Number.isFinite(derived) || derived < 0) return 0;
  return derived > maxMps ? 0 : derived;
}

function speedFromNeighbors(
  points: Array<{ lon: number; lat: number; timeMs: number }>,
  i: number,
): number | null {
  const cur = points[i]!;
  const prev = i > 0 ? points[i - 1]! : null;
  const next = i < points.length - 1 ? points[i + 1]! : null;
  if (prev && next && next.timeMs !== prev.timeMs) {
    return haversineM(prev.lat, prev.lon, next.lat, next.lon) / ((next.timeMs - prev.timeMs) / 1000);
  }
  if (prev && prev.timeMs !== cur.timeMs) {
    return haversineM(prev.lat, prev.lon, cur.lat, cur.lon) / ((cur.timeMs - prev.timeMs) / 1000);
  }
  if (next && next.timeMs !== cur.timeMs) {
    return haversineM(cur.lat, cur.lon, next.lat, next.lon) / ((next.timeMs - cur.timeMs) / 1000);
  }
  return null;
}

function headingAt(
  points: Array<{ lon: number; lat: number; timeMs: number }>,
  i: number,
  baselineSec: number,
  speedMps: number,
  minSpeed: number,
): number | null {
  if (speedMps < minSpeed) return null;
  const t = points[i]!.timeMs;
  const half = (baselineSec * 1000) / 2;
  let a = i;
  while (a > 0 && t - points[a - 1]!.timeMs <= half) a -= 1;
  let b = i;
  while (b < points.length - 1 && points[b + 1]!.timeMs - t <= half) b += 1;
  if (a === b) {
    if (i > 0) a = i - 1;
    else if (i < points.length - 1) b = i + 1;
    else return null;
  }
  const pa = points[a]!;
  const pb = points[b]!;
  if (haversineM(pa.lat, pa.lon, pb.lat, pb.lon) < 1.5) return null;
  return initialBearingDeg(pa.lat, pa.lon, pb.lat, pb.lon);
}

function detectOnFoil(
  points: Array<{ timeMs: number }>,
  speed: number[],
  t: FoilThresholds,
): boolean[] {
  const n = points.length;
  const on = new Array<boolean>(n).fill(false);
  let flying = false;
  let highSince: number | null = null;
  let lowSince: number | null = null;

  for (let i = 0; i < n; i++) {
    const dtPrev =
      i > 0 ? (points[i]!.timeMs - points[i - 1]!.timeMs) / 1000 : 0;
    if (i > 0 && dtPrev > t.maxGapSec) {
      flying = false;
      highSince = null;
      lowSince = null;
    }

    const v = speed[i]!;
    if (v >= t.takeoffMps) {
      if (highSince == null) highSince = points[i]!.timeMs;
      lowSince = null;
    } else {
      highSince = null;
    }
    if (v < t.landingMps) {
      if (lowSince == null) lowSince = points[i]!.timeMs;
    } else {
      lowSince = null;
    }

    if (!flying && highSince != null) {
      const held = (points[i]!.timeMs - highSince) / 1000;
      if (held >= t.takeoffHoldSec) flying = true;
    } else if (flying && lowSince != null) {
      const held = (points[i]!.timeMs - lowSince) / 1000;
      if (held >= t.landingHoldSec) flying = false;
    }
    on[i] = flying;
  }
  return on;
}

function buildSegments(
  points: Array<{ lon: number; lat: number; timeMs: number }>,
  exitSpeed: number[],
  onFoil: boolean[],
  t: FoilThresholds,
): FoilSegment[] {
  const raw: FoilSegment[] = [];
  let start: number | null = null;
  for (let i = 0; i < points.length; i++) {
    if (onFoil[i]) {
      if (start == null) start = i;
    } else if (start != null) {
      raw.push(makeSegment(points, start, i - 1, exitSpeed, t));
      start = null;
    }
  }
  if (start != null) {
    raw.push(makeSegment(points, start, points.length - 1, exitSpeed, t, true));
  }
  if (raw.length === 0) return raw;

  const merged: FoilSegment[] = [raw[0]!];
  for (let i = 1; i < raw.length; i++) {
    const prev = merged[merged.length - 1]!;
    const next = raw[i]!;
    const gapSec = (next.startTimeMs - prev.endTimeMs) / 1000;
    if (gapSec <= t.mergeGapSec) {
      merged[merged.length - 1] = makeSegment(
        points,
        prev.startIndex,
        next.endIndex,
        exitSpeed,
        t,
        next.endKind === "session-end",
      );
    } else {
      merged.push(next);
    }
  }
  return merged;
}

function makeSegment(
  points: Array<{ lon: number; lat: number; timeMs: number }>,
  startIndex: number,
  endIndex: number,
  exitSpeed: number[],
  t: FoilThresholds,
  sessionEnd = false,
): FoilSegment {
  const start = points[startIndex]!;
  const end = points[endIndex]!;
  let distanceM = 0;
  for (let i = startIndex + 1; i <= endIndex; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dt = (b.timeMs - a.timeMs) / 1000;
    if (dt <= t.maxGapSec) distanceM += haversineM(a.lat, a.lon, b.lat, b.lon);
  }
  return {
    startIndex,
    endIndex,
    startTimeMs: start.timeMs,
    endTimeMs: end.timeMs,
    durationSec: Math.max(0, (end.timeMs - start.timeMs) / 1000),
    distanceM,
    endKind: sessionEnd
      ? "session-end"
      : classifyExit(points, exitSpeed, endIndex, t),
  };
}

/** Fall vs touchdown from unsmoothed speed in the seconds after the last on-foil sample. */
function classifyExit(
  points: Array<{ timeMs: number }>,
  exitSpeed: number[],
  endIndex: number,
  t: FoilThresholds,
): "fall" | "touchdown" {
  const t0 = points[endIndex]!.timeMs;
  for (let i = endIndex; i < points.length; i++) {
    const dt = (points[i]!.timeMs - t0) / 1000;
    if (dt > t.fallWindowSec) break;
    if (exitSpeed[i]! < t.fallMps) return "fall";
  }
  return "touchdown";
}

function applyOnFoilFromSegments(onFoil: boolean[], segments: FoilSegment[]): void {
  onFoil.fill(false);
  for (const seg of segments) {
    for (let i = seg.startIndex; i <= seg.endIndex; i++) onFoil[i] = true;
  }
}

function detectManeuvers(
  points: FoilPoint[],
  t: FoilThresholds,
  hasWind: boolean,
): Maneuver[] {
  const n = points.length;
  const unwrapped = unwrapHeadings(points);
  const out: Maneuver[] = [];
  let i = 0;
  let cooldownUntilMs = -Infinity;
  while (i < n) {
    if (points[i]!.timeMs < cooldownUntilMs) {
      i += 1;
      continue;
    }
    if (!points[i]!.onFoil || unwrapped[i] == null) {
      i += 1;
      continue;
    }
    if (recentlyAfterGap(points, i, t.maneuverMaxGapSec, t.maneuverEntryHoldSec + 1)) {
      i += 1;
      continue;
    }
    const t0 = points[i]!.timeMs;
    let bestJ = -1;
    let bestAbs = 0;
    for (let j = i + 1; j < n; j++) {
      const dt = (points[j]!.timeMs - t0) / 1000;
      if (dt > t.maneuverWindowSec) break;
      if (unwrapped[j] == null) break;
      const gap = (points[j]!.timeMs - points[j - 1]!.timeMs) / 1000;
      if (gap > t.maneuverMaxGapSec) break;
      const abs = Math.abs(unwrapped[j]! - unwrapped[i]!);
      if (abs > bestAbs) {
        bestAbs = abs;
        bestJ = j;
      }
    }
    if (bestJ < 0 || bestAbs < t.maneuverMinTurnDeg) {
      i += 1;
      continue;
    }
    const dt = (points[bestJ]!.timeMs - t0) / 1000;
    if (dt < t.maneuverMinDurationSec || bestAbs / dt < t.maneuverMinRateDps) {
      i += 1;
      continue;
    }
    if (windowHasGap(points, i, bestJ, t.maneuverMaxGapSec)) {
      i += 1;
      continue;
    }

    const sign = Math.sign(unwrapped[bestJ]! - unwrapped[i]!);
    let end = bestJ;
    let slowSince: number | null = null;
    for (let j = bestJ + 1; j < n; j++) {
      const elapsed = (points[j]!.timeMs - t0) / 1000;
      if (elapsed > t.maneuverMaxDurationSec) break;
      if (unwrapped[j] == null || unwrapped[j - 1] == null) break;
      const gap = (points[j]!.timeMs - points[j - 1]!.timeMs) / 1000;
      if (gap > t.maneuverMaxGapSec || gap <= 0) break;
      const step = unwrapped[j]! - unwrapped[j - 1]!;
      const localSign = Math.sign(step);
      if (localSign !== 0 && localSign !== sign) break;
      const delta = unwrapped[j]! - unwrapped[i]!;
      if (Math.sign(delta) !== sign) break;
      if (Math.abs(delta) + 4 < bestAbs) break;
      const rate = Math.abs(step) / gap;
      if (rate < t.maneuverEndRateDps) {
        if (slowSince == null) slowSince = points[j]!.timeMs;
        if ((points[j]!.timeMs - slowSince) / 1000 >= 1) break;
        continue;
      }
      slowSince = null;
      if (Math.abs(delta) >= bestAbs) {
        bestAbs = Math.abs(delta);
        end = j;
      }
    }
    if (windowHasGap(points, i, end, t.maneuverMaxGapSec)) {
      i = Math.max(end, i + 1);
      continue;
    }
    if (headingStepTooSharp(unwrapped, i, end, t.maneuverMaxStepDeg)) {
      i = Math.max(end, i + 1);
      continue;
    }

    let apex = i;
    let peakRate = 0;
    for (let j = i + 1; j <= end; j++) {
      if (unwrapped[j] == null || unwrapped[j - 1] == null) continue;
      const ddt = (points[j]!.timeMs - points[j - 1]!.timeMs) / 1000;
      if (ddt <= 0) continue;
      const rate = Math.abs(unwrapped[j]! - unwrapped[j - 1]!) / ddt;
      if (rate > peakRate) {
        peakRate = rate;
        apex = j;
      }
    }

    const startH = meanHeading(points, Math.max(0, i - 2), i);
    const settled = settledHeading(points, unwrapped, end, t);
    const endH = settled.heading ?? points[end]!.headingDeg;
    const clockwise = sign > 0;
    const side: ManeuverSide = clockwise ? "starboard" : "port";
    const windDir = points[apex]!.windDirDeg ?? points[i]!.windDirDeg;
    if (
      hasWind &&
      windDir != null &&
      heldReachSide(points, i, windDir, t.maneuverEntryHoldSec) === 0
    ) {
      i = Math.max(end, i + 1);
      continue;
    }
    let type: ManeuverType | null = hasWind ? null : "transition";
    if (hasWind && startH != null && endH != null && windDir != null) {
      type = classifyTurn(startH, endH, clockwise, windDir, points[apex]!.headingDeg);
    }
    if (!type) {
      i += 1;
      continue;
    }

    let speedOk = true;
    const successUntilMs = points[end]!.timeMs + t.maneuverStabilizeSec * 1000;
    for (let j = i; j < n; j++) {
      if (j > end && points[j]!.timeMs > successUntilMs) break;
      if (points[j]!.speedSmoothMps < t.landingMps) {
        speedOk = false;
        break;
      }
    }
    const landedOnTack =
      !hasWind ||
      (startH != null &&
        endH != null &&
        windDir != null &&
        windSide(startH, windDir) !== 0 &&
        windSide(endH, windDir) !== 0 &&
        windSide(startH, windDir) !== windSide(endH, windDir));
    if (hasWind && !landedOnTack && speedOk) {
      i = Math.max(end, i + 1);
      continue;
    }
    const success = speedOk && settled.stable && landedOnTack;

    const apexPt = points[apex]!;
    out.push({
      type,
      side,
      success,
      timeMs: apexPt.timeMs,
      lon: apexPt.lon,
      lat: apexPt.lat,
      index: apex,
      startIndex: i,
      endIndex: end,
      turnDeg: bestAbs,
    });
    cooldownUntilMs = points[end]!.timeMs + t.maneuverCooldownSec * 1000;
    i = Math.max(end, i + 1);
  }
  return out;
}

function windowHasGap(
  points: FoilPoint[],
  from: number,
  to: number,
  maxGapSec: number,
): boolean {
  for (let j = from + 1; j <= to; j++) {
    if ((points[j]!.timeMs - points[j - 1]!.timeMs) / 1000 > maxGapSec) return true;
  }
  return false;
}

function recentlyAfterGap(
  points: FoilPoint[],
  at: number,
  maxGapSec: number,
  holdSec: number,
): boolean {
  const tMin = points[at]!.timeMs - holdSec * 1000;
  for (let j = at; j > 0; j--) {
    if (points[j]!.timeMs < tMin) break;
    const gap = (points[j]!.timeMs - points[j - 1]!.timeMs) / 1000;
    if (gap > maxGapSec) return true;
  }
  return false;
}

function headingStepTooSharp(
  unwrapped: Array<number | null>,
  from: number,
  to: number,
  maxStepDeg: number,
): boolean {
  for (let j = from + 1; j <= to; j++) {
    if (unwrapped[j] == null || unwrapped[j - 1] == null) return true;
    if (Math.abs(unwrapped[j]! - unwrapped[j - 1]!) > maxStepDeg) return true;
  }
  return false;
}

/** +1 = clockwise of upwind (port reach), −1 = CCW (starboard reach), 0 = head-to-wind or run. */
function windSide(headingDeg: number, windFromDeg: number): -1 | 0 | 1 {
  const d = wrap180(headingDeg - windFromDeg);
  const abs = Math.abs(d);
  if (abs < 25 || abs > 155) return 0;
  return d > 0 ? 1 : -1;
}

/** Same nonzero reach held for `holdSec` ending at `at`; otherwise 0. */
function heldReachSide(
  points: FoilPoint[],
  at: number,
  windDir: number,
  holdSec: number,
): -1 | 0 | 1 {
  const h0 = points[at]!.headingDeg;
  if (h0 == null) return 0;
  const side = windSide(h0, windDir);
  if (side === 0) return 0;
  const tMin = points[at]!.timeMs - holdSec * 1000;
  let earliest = at;
  for (let j = at; j >= 0; j--) {
    if (points[j]!.timeMs < tMin) break;
    const h = points[j]!.headingDeg;
    if (h == null) return 0;
    if (windSide(h, windDir) !== side) return 0;
    earliest = j;
  }
  if ((points[at]!.timeMs - points[earliest]!.timeMs) / 1000 < holdSec * 0.7) {
    return 0;
  }
  return side;
}

function classifyTurn(
  startH: number,
  endH: number,
  clockwise: boolean,
  windDir: number,
  apexH: number | null,
): ManeuverType | null {
  const upwind = windDir;
  const downwind = (windDir + 180) % 360;
  const throughUp = headingSwept(startH, endH, clockwise, upwind);
  const throughDown = headingSwept(startH, endH, clockwise, downwind);
  if (throughUp && !throughDown) return "tack";
  if (throughDown && !throughUp) return "jibe";
  if (throughUp && throughDown) {
    const at = apexH ?? startH;
    return Math.abs(wrap180(at - upwind)) <= Math.abs(wrap180(at - downwind))
      ? "tack"
      : "jibe";
  }
  return null;
}

function meanHeading(points: FoilPoint[], from: number, to: number): number | null {
  let x = 0;
  let y = 0;
  let n = 0;
  for (let i = from; i <= to; i++) {
    const h = points[i]?.headingDeg;
    if (h == null) continue;
    const r = (h * Math.PI) / 180;
    x += Math.cos(r);
    y += Math.sin(r);
    n += 1;
  }
  if (n === 0) return null;
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function settledHeading(
  points: FoilPoint[],
  unwrapped: Array<number | null>,
  end: number,
  t: FoilThresholds,
): { heading: number | null; stable: boolean } {
  const t0 = points[end]!.timeMs;
  let last = end;
  for (let j = end; j < points.length; j++) {
    if ((points[j]!.timeMs - t0) / 1000 > t.maneuverStabilizeSec) break;
    last = j;
  }
  if ((points[last]!.timeMs - t0) / 1000 < t.maneuverStabilizeSec * 0.7) {
    return { heading: points[end]!.headingDeg, stable: false };
  }
  const vals: number[] = [];
  for (let j = end; j <= last; j++) {
    if (unwrapped[j] == null) {
      return { heading: meanHeading(points, end, last), stable: false };
    }
    vals.push(unwrapped[j]!);
  }
  const spread = Math.max(...vals) - Math.min(...vals);
  return {
    heading: meanHeading(points, end, last),
    stable: spread <= t.maneuverStabilizeDeg,
  };
}

function unwrapHeadings(points: FoilPoint[]): Array<number | null> {
  const out: Array<number | null> = new Array(points.length).fill(null);
  let prev: number | null = null;
  let acc = 0;
  for (let i = 0; i < points.length; i++) {
    const h = points[i]!.headingDeg;
    if (h == null) {
      prev = null;
      out[i] = null;
      continue;
    }
    if (prev == null) {
      acc = h;
    } else {
      acc += wrap180(h - prev);
    }
    prev = h;
    out[i] = acc;
  }
  return out;
}

function headingSwept(
  start: number,
  end: number,
  clockwise: boolean,
  target: number,
): boolean {
  const span = clockwise
    ? (((end - start) % 360) + 360) % 360
    : (((start - end) % 360) + 360) % 360;
  if (span < 1) return false;
  const t = clockwise
    ? (((target - start) % 360) + 360) % 360
    : (((start - target) % 360) + 360) % 360;
  return t >= 0 && t <= span;
}

function buildEvents(
  points: FoilPoint[],
  segments: FoilSegment[],
  maneuvers: Maneuver[],
): FoilEvent[] {
  const events: FoilEvent[] = maneuvers.map((m) => ({
    kind: m.type,
    success: m.success,
    timeMs: m.timeMs,
    lon: m.lon,
    lat: m.lat,
    index: m.index,
    side: m.side,
    turnDeg: m.turnDeg,
    label: maneuverLabel(m),
  }));
  for (const seg of segments) {
    if (seg.endKind !== "fall") continue;
    const p = points[seg.endIndex]!;
    events.push({
      kind: "fall",
      success: false,
      timeMs: p.timeMs,
      lon: p.lon,
      lat: p.lat,
      index: p.index,
      label: "Fall",
    });
  }
  events.sort((a, b) => a.timeMs - b.timeMs);
  return events;
}

function maneuverLabel(m: Maneuver): string {
  const type =
    m.type === "tack" ? "Tack" : m.type === "jibe" ? "Jibe" : "Transition";
  const side = m.side === "port" ? "port" : "starboard";
  const result = m.success ? "made" : "failed";
  return `${type} ${side} · ${result}`;
}

function emptyBucket(): ManeuverBucket {
  return {
    attempted: 0,
    made: 0,
    port: { attempted: 0, made: 0 },
    starboard: { attempted: 0, made: 0 },
  };
}

function countBucket(maneuvers: Maneuver[], type: ManeuverType): ManeuverBucket {
  const b = emptyBucket();
  for (const m of maneuvers) {
    if (m.type !== type) continue;
    b.attempted += 1;
    b[m.side].attempted += 1;
    if (m.success) {
      b.made += 1;
      b[m.side].made += 1;
    }
  }
  return b;
}

function aggregateStats(
  points: FoilPoint[],
  segments: FoilSegment[],
  maneuvers: Maneuver[],
  hasWind: boolean,
): SessionStats {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let totalDistanceM = 0;
  let foilDistanceM = 0;
  let foilSpeedSum = 0;
  let foilSpeedN = 0;
  let upwindDistanceM = 0;
  let downwindDistanceM = 0;
  let reachingDistanceM = 0;
  let bestUpwindAngleDeg: number | null = null;
  let bestDownwindAngleDeg: number | null = null;
  let maxSpeedMps: number | null = null;

  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (maxSpeedMps == null || p.speedSmoothMps > maxSpeedMps) {
      maxSpeedMps = p.speedSmoothMps;
    }
    if (p.onFoil) {
      foilSpeedSum += p.speedSmoothMps;
      foilSpeedN += 1;
      if (p.windDirDeg != null && p.headingDeg != null) {
        const pointDeg = pointAngleFromPerp(p.headingDeg, p.windDirDeg);
        if (pointDeg != null) {
          if (bestUpwindAngleDeg == null || pointDeg > bestUpwindAngleDeg) {
            bestUpwindAngleDeg = pointDeg;
          }
          if (bestDownwindAngleDeg == null || pointDeg < bestDownwindAngleDeg) {
            bestDownwindAngleDeg = pointDeg;
          }
        }
      }
    }
    if (i === 0) continue;
    const prev = points[i - 1]!;
    const dt = (p.timeMs - prev.timeMs) / 1000;
    if (dt <= 0 || dt > DEFAULT_FOIL_THRESHOLDS.maxGapSec) continue;
    const d = haversineM(prev.lat, prev.lon, p.lat, p.lon);
    totalDistanceM += d;
    if (p.onFoil || prev.onFoil) {
      foilDistanceM += d;
      if (p.windDirDeg != null && p.headingDeg != null) {
        const pointDeg = pointAngleFromPerp(p.headingDeg, p.windDirDeg);
        if (pointDeg == null) {
          // skip
        } else if (Math.abs(pointDeg) < REACH_DEG) {
          reachingDistanceM += d;
        } else if (pointDeg > 0) {
          upwindDistanceM += d;
        } else {
          downwindDistanceM += d;
        }
      }
    }
  }

  const totalDurationSec = Math.max(0, (last.timeMs - first.timeMs) / 1000);
  const foilDurationSec = segments.reduce((s, seg) => s + seg.durationSec, 0);
  const longest = segments.reduce<FoilSegment | null>((best, seg) => {
    if (!best || seg.durationSec > best.durationSec) return seg;
    return best;
  }, null);

  return {
    totalDurationSec,
    totalDistanceM,
    foilDurationSec,
    foilDistanceM,
    foilTimePct: totalDurationSec > 0 ? (100 * foilDurationSec) / totalDurationSec : 0,
    foilDistancePct: totalDistanceM > 0 ? (100 * foilDistanceM) / totalDistanceM : 0,
    flightCount: segments.length,
    longestFlightSec: longest?.durationSec ?? 0,
    longestFlightM: longest?.distanceM ?? 0,
    timeToFirstFlightSec:
      segments.length > 0 ? (segments[0]!.startTimeMs - first.timeMs) / 1000 : null,
    tacks: countBucket(maneuvers, "tack"),
    jibes: countBucket(maneuvers, "jibe"),
    transitions: countBucket(maneuvers, "transition"),
    falls: segments.filter((s) => s.endKind === "fall").length,
    touchdowns: segments.filter((s) => s.endKind === "touchdown").length,
    maxSpeedMps,
    avgFoilSpeedMps: foilSpeedN > 0 ? foilSpeedSum / foilSpeedN : null,
    best5sMps: bestWindowSpeed(points, 5, DEFAULT_FOIL_THRESHOLDS.maxGapSec),
    best100mMps: bestDistanceSpeed(points, 100, DEFAULT_FOIL_THRESHOLDS.maxGapSec),
    best500mMps: bestDistanceSpeed(points, 500, DEFAULT_FOIL_THRESHOLDS.maxGapSec),
    upwindDistanceM,
    downwindDistanceM,
    reachingDistanceM,
    bestUpwindAngleDeg,
    bestDownwindAngleDeg,
    hasWind,
  };
}

function bestWindowSpeed(
  points: FoilPoint[],
  windowSec: number,
  maxGapSec: number,
): number | null {
  let best: number | null = null;
  for (let i = 0; i < points.length; i++) {
    let weighted = 0;
    let time = 0;
    for (let j = i + 1; j < points.length; j++) {
      const dt = (points[j]!.timeMs - points[j - 1]!.timeMs) / 1000;
      if (dt <= 0 || dt > maxGapSec) break;
      if ((points[j]!.timeMs - points[i]!.timeMs) / 1000 > windowSec) break;
      weighted += points[j]!.speedSmoothMps * dt;
      time += dt;
    }
    if (time >= windowSec * 0.8) {
      const v = weighted / time;
      if (best == null || v > best) best = v;
    }
  }
  return best;
}

function bestDistanceSpeed(
  points: FoilPoint[],
  targetM: number,
  maxGapSec: number,
): number | null {
  let best: number | null = null;
  for (let i = 0; i < points.length; i++) {
    let dist = 0;
    let time = 0;
    for (let j = i + 1; j < points.length; j++) {
      const dt = (points[j]!.timeMs - points[j - 1]!.timeMs) / 1000;
      if (dt <= 0 || dt > maxGapSec) break;
      dist += points[j]!.speedSmoothMps * dt;
      time += dt;
      if (dist >= targetM && time > 0.5) {
        const v = dist / time;
        if (best == null || v > best) best = v;
        break;
      }
    }
  }
  return best;
}

function buildTrackGeojson(
  points: FoilPoint[],
  track: GpxTrack,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  let i = 0;
  while (i < points.length) {
    const flag = points[i]!.onFoil;
    const coords: [number, number][] = [[points[i]!.lon, points[i]!.lat]];
    let j = i + 1;
    while (j < points.length && points[j]!.onFoil === flag) {
      coords.push([points[j]!.lon, points[j]!.lat]);
      j += 1;
    }
    if (j < points.length) coords.push([points[j]!.lon, points[j]!.lat]);
    if (coords.length >= 2) {
      features.push({
        type: "Feature",
        properties: { kind: "track", onFoil: flag },
        geometry: { type: "LineString", coordinates: coords },
      });
    }
    i = j;
  }
  const start = track.geojson.features.find((f) => f.properties?.kind === "start");
  const end = track.geojson.features.find((f) => f.properties?.kind === "end");
  if (start) features.push(start);
  if (end) features.push(end);
  return { type: "FeatureCollection", features };
}

function buildEventGeojson(events: FoilEvent[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: events.map((ev) => ({
      type: "Feature" as const,
      properties: {
        kind: ev.kind,
        success: ev.success,
        label: ev.label,
        timeMs: ev.timeMs,
        side: ev.side ?? null,
      },
      geometry: {
        type: "Point" as const,
        coordinates: [ev.lon, ev.lat],
      },
    })),
  };
}

function rollingMedian(values: number[], window: number): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const a = Math.max(0, i - half);
    const b = Math.min(values.length, i + half + 1);
    const slice = values.slice(a, b).sort((x, y) => x - y);
    const mid = Math.floor(slice.length / 2);
    return slice.length % 2 === 1
      ? slice[mid]!
      : (slice[mid - 1]! + slice[mid]!) / 2;
  });
}

function ema(values: number[], alpha: number): number[] {
  if (values.length === 0) return [];
  const out = new Array<number>(values.length);
  out[0] = values[0]!;
  for (let i = 1; i < values.length; i++) {
    out[i] = alpha * values[i]! + (1 - alpha) * out[i - 1]!;
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function initialBearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
