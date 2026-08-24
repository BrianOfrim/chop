import type { Map as MapLibreMap } from "maplibre-gl";
import type { GpxTrack } from "./gpx";

export type ReviewCursor = {
  lon: number;
  lat: number;
  headingDeg?: number | null;
};

export type ReviewWindTick = {
  lon: number;
  lat: number;
  windDirDeg: number;
};

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

  for (const f of track.geojson.features) {
    const kind = f.properties?.kind;
    if (kind !== "track" && kind !== "route") continue;
    if (f.geometry.type !== "LineString") continue;
    ctx.strokeStyle = "rgba(248, 246, 240, 0.95)";
    ctx.lineWidth = 6.5;
    strokeLine(ctx, map, f.geometry.coordinates);
    ctx.strokeStyle = "rgba(196, 92, 26, 0.95)";
    ctx.lineWidth = 3.2;
    strokeLine(ctx, map, f.geometry.coordinates);
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
