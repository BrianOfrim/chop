/** Parse a GPX document into a map-ready track. */

export type GpxPoint = {
  lon: number;
  lat: number;
  /** ISO timestamp when present on the point. */
  time: string | null;
  timeMs: number | null;
  /** Ground speed m/s when known (Strava velocity stream). */
  speedMps?: number | null;
};

export type GpxTrack = {
  name: string;
  filename: string;
  /** Prefer track name; fall back to filename without extension. */
  label: string;
  startTime: string | null;
  endTime: string | null;
  pointCount: number;
  /** All track/route points in file order (may omit times). */
  points: GpxPoint[];
  bounds: {
    west: number;
    south: number;
    east: number;
    north: number;
  };
  geojson: GeoJSON.FeatureCollection;
};

function textOf(el: Element | null): string | null {
  if (!el) return null;
  const t = el.textContent?.trim();
  return t ? t : null;
}

function parseCoord(lat: string | null, lon: string | null): [number, number] | null {
  if (lat == null || lon == null) return null;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  return [lo, la];
}

function parseTime(raw: string | null): { time: string | null; timeMs: number | null } {
  if (!raw) return { time: null, timeMs: null };
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return { time: raw, timeMs: null };
  return { time: raw, timeMs: ms };
}

function collectPoints(root: Element, tag: string): GpxPoint[] {
  const out: GpxPoint[] = [];
  const nodes = root.getElementsByTagName(tag);
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i]!;
    const coord = parseCoord(el.getAttribute("lat"), el.getAttribute("lon"));
    if (!coord) continue;
    const { time, timeMs } = parseTime(
      textOf(el.getElementsByTagName("time")[0] ?? null),
    );
    out.push({ lon: coord[0], lat: coord[1], time, timeMs });
  }
  return out;
}

/**
 * Parse GPX XML text. Supports tracks (`trkpt`) and routes (`rtept`).
 * Multiple track segments become separate LineString features.
 */
export function parseGpx(xmlText: string, filename = "track.gpx"): GpxTrack {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Could not parse GPX — file may be invalid XML");
  }

  const gpx = doc.documentElement;
  if (!gpx || gpx.localName.toLowerCase() !== "gpx") {
    throw new Error("Not a GPX file");
  }

  const features: GeoJSON.Feature[] = [];
  const allPoints: GpxPoint[] = [];
  let firstTime: string | null = null;
  let lastTime: string | null = null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  function absorb(points: GpxPoint[], kind: "track" | "route", name: string | null) {
    if (points.length < 2) return;
    const coords = points.map((p) => [p.lon, p.lat] as [number, number]);
    for (const p of points) {
      west = Math.min(west, p.lon);
      east = Math.max(east, p.lon);
      south = Math.min(south, p.lat);
      north = Math.max(north, p.lat);
      allPoints.push(p);
      if (p.time && p.timeMs != null) {
        if (!firstTime || p.timeMs < Date.parse(firstTime)) firstTime = p.time;
        if (!lastTime || p.timeMs > Date.parse(lastTime)) lastTime = p.time;
      }
    }
    features.push({
      type: "Feature",
      properties: { kind, name },
      geometry: { type: "LineString", coordinates: coords },
    });
  }

  const tracks = gpx.getElementsByTagName("trk");
  if (tracks.length > 0) {
    for (let ti = 0; ti < tracks.length; ti++) {
      const trk = tracks[ti]!;
      const name = textOf(trk.getElementsByTagName("name")[0] ?? null);
      const segs = trk.getElementsByTagName("trkseg");
      if (segs.length > 0) {
        for (let si = 0; si < segs.length; si++) {
          absorb(collectPoints(segs[si]!, "trkpt"), "track", name);
        }
      } else {
        absorb(collectPoints(trk, "trkpt"), "track", name);
      }
    }
  } else {
    const routes = gpx.getElementsByTagName("rte");
    for (let ri = 0; ri < routes.length; ri++) {
      const rte = routes[ri]!;
      const name = textOf(rte.getElementsByTagName("name")[0] ?? null);
      absorb(collectPoints(rte, "rtept"), "route", name);
    }
  }

  if (features.length === 0) {
    absorb(collectPoints(gpx, "trkpt"), "track", null);
    if (features.length === 0) absorb(collectPoints(gpx, "rtept"), "route", null);
  }

  if (features.length === 0) {
    throw new Error("GPX has no track or route points");
  }

  const metaName =
    textOf(gpx.getElementsByTagName("name")[0] ?? null) ||
    (features[0]?.properties?.name as string | null) ||
    null;
  const base = filename.replace(/\.[^.]+$/, "") || filename;

  const firstLine = features[0]!.geometry as GeoJSON.LineString;
  const start = firstLine.coordinates[0]!;
  const lastFeat = features[features.length - 1]!;
  const lastLine = lastFeat.geometry as GeoJSON.LineString;
  const end = lastLine.coordinates[lastLine.coordinates.length - 1]!;
  features.push(
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
  );

  return {
    name: metaName ?? base,
    filename,
    label: metaName ?? base,
    startTime: firstTime,
    endTime: lastTime,
    pointCount: allPoints.length,
    points: allPoints,
    bounds: { west, south, east, north },
    geojson: { type: "FeatureCollection", features },
  };
}

export async function parseGpxFile(file: File): Promise<GpxTrack> {
  const text = await file.text();
  return parseGpx(text, file.name);
}

/** Timed points only, downsampled to at most `maxPoints` by uniform time. */
export function timedTrackPoints(
  track: GpxTrack,
  maxPoints = 180,
): GpxPoint[] {
  const timed = track.points.filter(
    (p): p is GpxPoint & { time: string; timeMs: number } =>
      p.time != null && p.timeMs != null,
  );
  if (timed.length <= maxPoints) return timed;
  const t0 = timed[0]!.timeMs;
  const t1 = timed[timed.length - 1]!.timeMs;
  if (t1 <= t0) return timed.slice(0, maxPoints);
  const out: GpxPoint[] = [];
  let cursor = 0;
  for (let i = 0; i < maxPoints; i++) {
    const target = t0 + ((t1 - t0) * i) / (maxPoints - 1);
    while (cursor < timed.length - 1 && timed[cursor + 1]!.timeMs <= target) {
      cursor += 1;
    }
    const a = timed[cursor]!;
    const b = timed[Math.min(cursor + 1, timed.length - 1)]!;
    const pick =
      Math.abs(b.timeMs - target) < Math.abs(a.timeMs - target) ? b : a;
    if (out.length === 0 || out[out.length - 1] !== pick) out.push(pick);
  }
  return out;
}
