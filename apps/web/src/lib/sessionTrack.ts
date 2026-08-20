import {
  hsAtLonLat,
  windDurationSec,
  type LakeGrids,
} from "@chop/wave-engine";
import { timedTrackPoints, type GpxPoint, type GpxTrack } from "./gpx";
import { nearestHourIndex, type WindHour } from "./wind";

export type SessionSample = {
  time: string;
  timeMs: number;
  lon: number;
  lat: number;
  hsM: number | null;
  /** GPS/Strava ground speed, m/s. */
  speedMps: number | null;
  /** Travel heading, degrees clockwise from north. */
  headingDeg: number | null;
  /**
   * Course vs wind, relative to a beam reach (perpendicular to the wind).
   * +90° = dead upwind, 0° = reach, −90° = dead downwind.
   */
  pointDeg: number | null;
  wind: WindHour;
  hourIndex: number;
};

const MIN_HEADING_SPEED_MPS = 0.4;

/** Build along-track Hs samples using the nearest HRDPS hour at each GPS time. */
export function buildSessionSeries(
  track: GpxTrack,
  hours: WindHour[],
  grids: LakeGrids,
  maxPoints = 180,
): SessionSample[] {
  if (hours.length === 0) return [];
  const points = timedTrackPoints(track, maxPoints);

  return points.map((p, i) => {
    const hourIndex = nearestHourIndex(hours, p.timeMs!);
    const wind = hours[hourIndex]!;
    const recorded =
      p.speedMps != null && Number.isFinite(p.speedMps) ? p.speedMps : null;
    const speedMps = recorded ?? speedFromNeighbors(points, i);
    const headingDeg =
      speedMps != null && speedMps >= MIN_HEADING_SPEED_MPS
        ? headingFromNeighbors(points, i)
        : null;
    return {
      time: p.time!,
      timeMs: p.timeMs!,
      lon: p.lon,
      lat: p.lat,
      hsM: hsAtLonLat(
        grids,
        p.lon,
        p.lat,
        wind.windSpeedMps,
        wind.windDirDeg,
        windDurationSec(hours, hourIndex),
      ),
      speedMps,
      headingDeg,
      pointDeg: pointAngleFromPerp(headingDeg, wind.windDirDeg),
      wind,
      hourIndex,
    };
  });
}

/** Smallest signed difference a−b in (−180, 180]. */
export function wrap180(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/**
 * Angle from a beam reach: +upwind / −downwind, 0 = perpendicular to the wind.
 * Wind is meteorological FROM direction.
 */
export function pointAngleFromPerp(
  headingDeg: number | null | undefined,
  windFromDeg: number,
): number | null {
  if (headingDeg == null || !Number.isFinite(headingDeg) || !Number.isFinite(windFromDeg)) {
    return null;
  }
  const fromUpwind = Math.abs(wrap180(headingDeg - windFromDeg));
  return 90 - fromUpwind;
}

export function sessionPointLabel(
  pointDeg: number | null | undefined,
): string | null {
  if (pointDeg == null || !Number.isFinite(pointDeg)) return null;
  const abs = Math.abs(pointDeg);
  if (abs < 8) return "Beam reach";
  if (pointDeg > 0) return `Upwind ${Math.round(abs)}°`;
  return `Downwind ${Math.round(abs)}°`;
}

function speedFromNeighbors(
  points: Array<{ lon: number; lat: number; timeMs: number | null }>,
  i: number,
): number | null {
  const cur = points[i]!;
  if (cur.timeMs == null) return null;
  const prev = i > 0 ? points[i - 1]! : null;
  const next = i < points.length - 1 ? points[i + 1]! : null;
  const a = prev?.timeMs != null ? prev : null;
  const b = next?.timeMs != null ? next : null;
  if (a && b && b.timeMs! !== a.timeMs) {
    return haversineM(a.lat, a.lon, b.lat, b.lon) / ((b.timeMs! - a.timeMs!) / 1000);
  }
  if (a && a.timeMs !== cur.timeMs) {
    return haversineM(a.lat, a.lon, cur.lat, cur.lon) / ((cur.timeMs - a.timeMs) / 1000);
  }
  if (b && b.timeMs !== cur.timeMs) {
    return haversineM(cur.lat, cur.lon, b.lat, b.lon) / ((b.timeMs! - cur.timeMs) / 1000);
  }
  return null;
}

function headingFromNeighbors(
  points: Array<{ lon: number; lat: number; timeMs: number | null }>,
  i: number,
): number | null {
  const cur = points[i]!;
  const prev = i > 0 ? points[i - 1]! : null;
  const next = i < points.length - 1 ? points[i + 1]! : null;
  if (prev && next) return initialBearingDeg(prev.lat, prev.lon, next.lat, next.lon);
  if (prev) return initialBearingDeg(prev.lat, prev.lon, cur.lat, cur.lon);
  if (next) return initialBearingDeg(cur.lat, cur.lon, next.lat, next.lon);
  return null;
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

export function sessionDateRange(track: GpxTrack): {
  startDate: string;
  endDate: string;
} | null {
  if (!track.startTime || !track.endTime) return null;
  const t0 = Date.parse(track.startTime);
  const t1 = Date.parse(track.endTime);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  // Pad half a day so local/UTC calendar edges still cover the session.
  const pad = 12 * 60 * 60 * 1000;
  return {
    startDate: ymdUtc(t0 - pad),
    endDate: ymdUtc(t1 + pad),
  };
}

function ymdUtc(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type { GpxPoint };
