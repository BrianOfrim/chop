import type { GpxPoint, GpxTrack } from "./gpx";
import type { StravaTrackPayload } from "./strava";

/** Map a Strava lat/lng + time stream into the GPX track shape Chop already replays. */
export function gpxTrackFromStrava(payload: StravaTrackPayload): GpxTrack {
  const startMs = Date.parse(payload.startDate);
  const n = payload.latlng.length;
  if (n < 2) {
    throw new Error("Strava activity has no GPS track");
  }

  const points: GpxPoint[] = [];
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (let i = 0; i < n; i++) {
    const pair = payload.latlng[i]!;
    const lat = pair[0];
    const lon = pair[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);

    const offsetSec = payload.timeOffsetsSec[i];
    const timeMs =
      Number.isFinite(startMs) && offsetSec != null && Number.isFinite(offsetSec)
        ? startMs + offsetSec * 1000
        : null;
    const rawSpeed = payload.velocityMps?.[i];
    const speedMps =
      rawSpeed != null && Number.isFinite(rawSpeed) && rawSpeed >= 0
        ? rawSpeed
        : null;
    points.push({
      lon,
      lat,
      time: timeMs != null ? new Date(timeMs).toISOString() : null,
      timeMs,
      speedMps,
    });
  }

  if (points.length < 2) {
    throw new Error("Strava activity has no usable GPS points");
  }

  const timed = points.filter((p) => p.timeMs != null);
  const startTime = timed[0]?.time ?? null;
  const endTime = timed[timed.length - 1]?.time ?? null;
  const coords = points.map((p) => [p.lon, p.lat] as [number, number]);
  const start = coords[0]!;
  const end = coords[coords.length - 1]!;
  const label = payload.name.trim() || `Strava ${payload.id}`;

  return {
    name: label,
    filename: `strava-${payload.id}`,
    label,
    startTime,
    endTime,
    pointCount: points.length,
    points,
    bounds: { west, south, east, north },
    geojson: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { kind: "track", name: label, sportType: payload.sportType },
          geometry: { type: "LineString", coordinates: coords },
        },
        {
          type: "Feature",
          properties: { kind: "start" },
          geometry: { type: "Point", coordinates: start },
        },
        {
          type: "Feature",
          properties: { kind: "end" },
          geometry: { type: "Point", coordinates: end },
        },
      ],
    },
  };
}
