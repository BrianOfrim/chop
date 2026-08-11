import {
  computeHsGrid,
  sampleGridNearestWater,
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
  wind: WindHour;
  hourIndex: number;
};

/** Build along-track Hs samples using the nearest HRDPS hour at each GPS time. */
export function buildSessionSeries(
  track: GpxTrack,
  hours: WindHour[],
  grids: LakeGrids,
  maxPoints = 180,
): SessionSample[] {
  if (hours.length === 0) return [];
  const points = timedTrackPoints(track, maxPoints);
  const hsCache = new Map<number, Float32Array>();

  function hsForHour(i: number): Float32Array {
    let hs = hsCache.get(i);
    if (!hs) {
      const h = hours[i]!;
      hs = computeHsGrid(grids, h.windSpeedMps, h.windDirDeg);
      hsCache.set(i, hs);
    }
    return hs;
  }

  return points.map((p) => {
    const hourIndex = nearestHourIndex(hours, p.timeMs!);
    const wind = hours[hourIndex]!;
    const hs = hsForHour(hourIndex);
    return {
      time: p.time!,
      timeMs: p.timeMs!,
      lon: p.lon,
      lat: p.lat,
      hsM: sampleGridNearestWater(hs, grids.meta, p.lon, p.lat),
      wind,
      hourIndex,
    };
  });
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
