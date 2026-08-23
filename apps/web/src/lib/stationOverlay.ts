import type { Map as MapLibreMap } from "maplibre-gl";
import type { StationFeature, StationsResponse } from "./stations";
import { formatWindSpeed, type WindSpeedUnit } from "./units";

/** Match MapLibre wx-stations halo radius (zoom 4 → 12). */
function haloRadius(zoom: number): number {
  const t = Math.max(0, Math.min(1, (zoom - 4) / 8));
  return 5 + t * 4;
}

function innerRadius(zoom: number): number {
  const t = Math.max(0, Math.min(1, (zoom - 4) / 8));
  return 2.4 + t * 1.6;
}

export function formatStationWindLabel(
  mps: number | null | undefined,
  unit: WindSpeedUnit,
): string | null {
  if (mps == null || !Number.isFinite(mps)) return null;
  return formatWindSpeed(mps, unit);
}

function diamondPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bearing: number,
  color: string,
  halo: string,
): void {
  const size = 23;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((bearing * Math.PI) / 180);
  ctx.translate(0, -18);
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.4);
  ctx.lineTo(size * 0.22, size * 0.18);
  ctx.lineTo(0, size * 0.05);
  ctx.lineTo(-size * 0.22, size * 0.18);
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.strokeStyle = halo;
  ctx.lineWidth = 3.2;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawOne(
  ctx: CanvasRenderingContext2D,
  map: MapLibreMap,
  feature: StationFeature,
  cssW: number,
  cssH: number,
  zoom: number,
  satellite: boolean,
  selected: boolean,
  windUnit: WindSpeedUnit,
): void {
  const [lon, lat] = feature.geometry.coordinates;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
  const p = map.project([lon, lat]);
  if (p.x < -40 || p.y < -36 || p.x > cssW + 56 || p.y > cssH + 28) return;

  const halo = satellite ? "rgba(12, 16, 14, 0.88)" : "rgba(248, 246, 240, 0.95)";
  const stroke = satellite ? "#f4f1ea" : "#1c201e";
  const ink = feature.properties.hasObs > 0 ? "#2c5a82" : "#8a8680";
  const r = haloRadius(zoom) + (selected ? 1.2 : 0);
  const inner = innerRadius(zoom);

  diamondPath(ctx, p.x, p.y, r);
  ctx.fillStyle = satellite ? "rgba(20, 28, 26, 0.9)" : "rgba(248, 246, 240, 0.92)";
  ctx.fill();
  ctx.lineWidth = selected ? 1.9 : 1.35;
  ctx.strokeStyle = stroke;
  ctx.stroke();

  diamondPath(ctx, p.x, p.y, inner);
  ctx.fillStyle = ink;
  ctx.fill();

  if (
    feature.properties.hasWind > 0 &&
    feature.properties.bearing != null &&
    Number.isFinite(feature.properties.bearing)
  ) {
    drawArrow(ctx, p.x, p.y, feature.properties.bearing, ink, halo);
  }

  const speed = formatStationWindLabel(
    feature.properties.windSpeedMps,
    windUnit,
  );
  ctx.lineJoin = "round";
  if (speed) {
    ctx.font = `600 11px "IBM Plex Sans", "Helvetica Neue", sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = halo;
    ctx.lineWidth = 3.6;
    ctx.strokeText(speed, p.x + r + 5, p.y);
    ctx.fillStyle = stroke;
    ctx.fillText(speed, p.x + r + 5, p.y);
  }

  if (zoom < 7.2) return;
  ctx.font = `500 11px "IBM Plex Sans", "Helvetica Neue", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.strokeStyle = halo;
  ctx.lineWidth = 3.4;
  ctx.strokeText(feature.properties.name, p.x, p.y + r + 3);
  ctx.fillStyle = stroke;
  ctx.fillText(feature.properties.name, p.x, p.y + r + 3);
}

/**
 * Screen-space stations above MapLibre heatmaps and the particle canvas.
 * Call after the overlay canvas is sized; this clears and paints stations only.
 * Diamonds (not circles) so they do not read as lake forecast pins.
 */
export function drawStations(
  canvas: HTMLCanvasElement,
  map: MapLibreMap,
  data: StationsResponse | null | undefined,
  satellite: boolean,
  selectedId?: string | null,
  windUnit: WindSpeedUnit = "kt",
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
  if (!data?.features.length) return;
  const zoom = map.getZoom();
  for (const feature of data.features) {
    drawOne(
      ctx,
      map,
      feature,
      cssW,
      cssH,
      zoom,
      satellite,
      feature.properties.id === selectedId,
      windUnit,
    );
  }
}
