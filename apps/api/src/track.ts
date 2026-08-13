import { stravaGet } from "./strava.ts";

export type StravaActivitySummary = {
  id: number;
  name: string;
  sportType: string;
  startDate: string;
  elapsedTime: number;
  movingTime: number;
  distanceM: number;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
};

export type StravaTrackPayload = {
  id: number;
  name: string;
  sportType: string;
  startDate: string;
  latlng: [number, number][];
  timeOffsetsSec: number[];
  /** Ground speed m/s from Strava `velocity_smooth`, aligned to latlng. */
  velocityMps: Array<number | null>;
};

type StravaActivity = {
  id: number;
  name?: string;
  sport_type?: string;
  type?: string;
  start_date?: string;
  elapsed_time?: number;
  moving_time?: number;
  distance?: number;
  start_latlng?: unknown;
  end_latlng?: unknown;
};

type StreamSeries = {
  data?: unknown[];
};

type StreamsByType = {
  latlng?: StreamSeries;
  time?: StreamSeries;
  velocity_smooth?: StreamSeries;
};

function pairOrNull(value: unknown): { lat: number; lon: number } | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lat = Number(value[0]);
  const lon = Number(value[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

export function summarizeActivity(a: StravaActivity): StravaActivitySummary {
  const start = pairOrNull(a.start_latlng);
  const end = pairOrNull(a.end_latlng);
  return {
    id: a.id,
    name: a.name?.trim() || `Activity ${a.id}`,
    sportType: a.sport_type || a.type || "Workout",
    startDate: a.start_date || "",
    elapsedTime: a.elapsed_time ?? 0,
    movingTime: a.moving_time ?? 0,
    distanceM: a.distance ?? 0,
    startLat: start?.lat ?? null,
    startLon: start?.lon ?? null,
    endLat: end?.lat ?? null,
    endLon: end?.lon ?? null,
  };
}

function asLatLng(data: unknown[] | undefined): [number, number][] {
  if (!data) return [];
  const out: [number, number][] = [];
  for (const row of data) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const lat = Number(row[0]);
    const lon = Number(row[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push([lat, lon]);
  }
  return out;
}

function asTimeOffsets(data: unknown[] | undefined): number[] {
  if (!data) return [];
  return data.map((v) => Number(v)).filter((n) => Number.isFinite(n));
}

function asVelocity(data: unknown[] | undefined, n: number): Array<number | null> {
  const out: Array<number | null> = Array.from({ length: n }, () => null);
  if (!data) return out;
  for (let i = 0; i < Math.min(n, data.length); i++) {
    const v = Number(data[i]);
    out[i] = Number.isFinite(v) && v >= 0 ? v : null;
  }
  return out;
}

export async function fetchActivityTrack(
  id: number,
): Promise<StravaTrackPayload> {
  const [activity, streams] = await Promise.all([
    stravaGet<StravaActivity>(`/activities/${id}`),
    stravaGet<StreamsByType>(
      `/activities/${id}/streams?keys=latlng,time,velocity_smooth&key_by_type=true`,
    ),
  ]);

  const latlng = asLatLng(streams.latlng?.data);
  const timeOffsetsSec = asTimeOffsets(streams.time?.data);
  if (latlng.length < 2) {
    throw new Error("Activity has no GPS track");
  }

  const startDate = activity.start_date || new Date().toISOString();
  return {
    id: activity.id,
    name: activity.name?.trim() || `Activity ${id}`,
    sportType: activity.sport_type || activity.type || "Workout",
    startDate,
    latlng,
    timeOffsetsSec:
      timeOffsetsSec.length === latlng.length
        ? timeOffsetsSec
        : timeOffsetsSec.slice(0, latlng.length),
    velocityMps: asVelocity(streams.velocity_smooth?.data, latlng.length),
  };
}
