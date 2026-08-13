export type StravaAthlete = {
  id: number;
  firstname?: string;
  lastname?: string;
};

export type StravaStatus = {
  connected: boolean;
  configured?: boolean;
  athlete?: StravaAthlete | null;
};

export type StravaActivity = {
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

export type LakeBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

/** Shoreline/parking pad around the water grid; keeps nearby lakes separate. */
export function expandLakeBounds(
  b: LakeBounds,
  padFrac = 0.15,
  minPadDeg = 0.015,
): LakeBounds {
  const dLon = Math.max(minPadDeg, (b.east - b.west) * padFrac);
  const dLat = Math.max(minPadDeg, (b.north - b.south) * padFrac);
  return {
    west: b.west - dLon,
    east: b.east + dLon,
    south: b.south - dLat,
    north: b.north + dLat,
  };
}

function pointInBounds(lat: number, lon: number, b: LakeBounds): boolean {
  return lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north;
}

export function activityAtLake(
  activity: StravaActivity,
  bounds: LakeBounds | null,
): boolean {
  if (!bounds) return false;
  const padded = expandLakeBounds(bounds);
  if (
    activity.startLat != null &&
    activity.startLon != null &&
    pointInBounds(activity.startLat, activity.startLon, padded)
  ) {
    return true;
  }
  if (
    activity.endLat != null &&
    activity.endLon != null &&
    pointInBounds(activity.endLat, activity.endLon, padded)
  ) {
    return true;
  }
  return false;
}

export type StravaTrackPayload = {
  id: number;
  name: string;
  sportType: string;
  startDate: string;
  latlng: [number, number][];
  timeOffsetsSec: number[];
};

export const WATERSPORT_TYPES = new Set([
  "Kitesurf",
  "Windsurf",
  "StandUpPaddling",
  "Surfing",
  "Kayaking",
  "Canoeing",
  "Rowing",
  "Sail",
  "Swim",
]);

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body && body.error
        ? String(body.error)
        : `Strava request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

export async function fetchStravaStatus(): Promise<StravaStatus> {
  const res = await fetch("/api/strava/status");
  return readJson<StravaStatus>(res);
}

export async function fetchStravaActivities(
  page = 1,
  perPage = 50,
): Promise<{ page: number; perPage: number; activities: StravaActivity[] }> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
  });
  const res = await fetch(`/api/strava/activities?${params}`);
  return readJson(res);
}

export async function fetchStravaTrack(
  id: number,
): Promise<StravaTrackPayload> {
  const res = await fetch(`/api/strava/activities/${id}/track`);
  return readJson<StravaTrackPayload>(res);
}

export async function disconnectStrava(): Promise<void> {
  const res = await fetch("/api/strava/disconnect", { method: "POST" });
  await readJson(res);
}

export function stravaConnectHref(): string {
  return "/api/auth/strava";
}
