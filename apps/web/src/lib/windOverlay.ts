import albertaMask from "../data/albertaMask.json";
import { DEFAULT_WIND_SCALE } from "./colorScales";
import { windColor, WIND_COLOR_MAX_MPS } from "./windScale";
import {
  WIND_FIELD_STEP_M,
  windFieldExtent,
  windFieldSize,
  windGridLat,
  windGridLon,
  type WindFieldSlice,
} from "./windField";

export const WIND_CANVAS_SCALE = 32;

const ALBERTA_OUTLINE = (albertaMask as GeoJSON.FeatureCollection).features.find(
  (f) => f.properties?.kind === "outline",
);

function lonLatToPx(
  lon: number,
  lat: number,
  west: number,
  south: number,
  east: number,
  north: number,
  width: number,
  height: number,
): [number, number] {
  const x = ((lon - west) / (east - west)) * width;
  const y = ((north - lat) / (north - south)) * height;
  return [x, y];
}

function addRing(
  ctx: CanvasRenderingContext2D,
  ring: number[][],
  west: number,
  south: number,
  east: number,
  north: number,
  width: number,
  height: number,
) {
  if (ring.length < 3) return;
  const first = ring[0]!;
  const [x0, y0] = lonLatToPx(
    first[0]!,
    first[1]!,
    west,
    south,
    east,
    north,
    width,
    height,
  );
  ctx.moveTo(x0, y0);
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i]!;
    const [x, y] = lonLatToPx(
      p[0]!,
      p[1]!,
      west,
      south,
      east,
      north,
      width,
      height,
    );
    ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function windCanvasSize(): { width: number; height: number } {
  const { ncols, nrows } = windFieldSize();
  return {
    width: Math.max(1, ncols * WIND_CANVAS_SCALE),
    height: Math.max(1, nrows * WIND_CANVAS_SCALE),
  };
}

export function windCanvasCoordinates(): [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] {
  const { west, south, east, north } = windFieldExtent();
  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];
}

export function buildAlbertaWindMask(): HTMLCanvasElement {
  const { width, height } = windCanvasSize();
  const { west, south, east, north } = windFieldExtent();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  const g = ALBERTA_OUTLINE?.geometry;
  if (g?.type === "Polygon") {
    for (const ring of g.coordinates) {
      addRing(ctx, ring, west, south, east, north, width, height);
    }
  } else if (g?.type === "MultiPolygon") {
    for (const poly of g.coordinates) {
      for (const ring of poly) {
        addRing(ctx, ring, west, south, east, north, width, height);
      }
    }
  }
  ctx.fill("evenodd");
  return canvas;
}

function sampleCell(
  slice: WindFieldSlice,
  i: number,
  j: number,
): { s: number; d: number } | null {
  if (i < 0 || j < 0 || i >= slice.ncols || j >= slice.nrows) return null;
  const idx = j * slice.ncols + i;
  const s = slice.speed[idx]!;
  const d = slice.dir[idx]!;
  if (!Number.isFinite(s) || !Number.isFinite(d)) return null;
  return { s, d };
}

function bilinearSpeed(slice: WindFieldSlice, fx: number, fy: number): number {
  const i0 = Math.min(slice.ncols - 1, Math.max(0, Math.floor(fx)));
  const j0 = Math.min(slice.nrows - 1, Math.max(0, Math.floor(fy)));
  const i1 = Math.min(slice.ncols - 1, i0 + 1);
  const j1 = Math.min(slice.nrows - 1, j0 + 1);
  const a = sampleCell(slice, i0, j0);
  const b = sampleCell(slice, i1, j0);
  const c = sampleCell(slice, i0, j1);
  const d = sampleCell(slice, i1, j1);
  if (!a || !b || !c || !d) return a?.s ?? b?.s ?? c?.s ?? d?.s ?? Number.NaN;
  const tx = fx - Math.floor(fx);
  const ty = fy - Math.floor(fy);
  return (
    a.s * (1 - tx) * (1 - ty) +
    b.s * tx * (1 - ty) +
    c.s * (1 - tx) * ty +
    d.s * tx * ty
  );
}

function maskHasFill(mask: HTMLCanvasElement): boolean {
  const c = mask.getContext("2d");
  if (!c) return false;
  const { data } = c.getImageData(0, 0, mask.width, mask.height);
  for (let i = 3; i < data.length; i += 64) {
    if ((data[i] ?? 0) > 0) return true;
  }
  return false;
}

export function paintWindField(
  ctx: CanvasRenderingContext2D,
  slice: WindFieldSlice,
  mask: HTMLCanvasElement,
): void {
  const canvas = ctx.canvas;
  const width = mask.width;
  const height = mask.height;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const img = ctx.createImageData(width, height);
  const px = img.data;
  for (let y = 0; y < height; y++) {
    const fy = ((y + 0.5) / height) * slice.nrows - 0.5;
    for (let x = 0; x < width; x++) {
      const fx = ((x + 0.5) / width) * slice.ncols - 0.5;
      const s = bilinearSpeed(slice, fx, fy);
      const o = (y * width + x) * 4;
      if (!Number.isFinite(s) || s < 0) {
        px[o + 3] = 0;
        continue;
      }
      const [r, g, b, a] = windColor(s, WIND_COLOR_MAX_MPS, DEFAULT_WIND_SCALE);
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = a;
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, width, height);
  ctx.putImageData(img, 0, 0);
  if (maskHasFill(mask)) {
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
  }
}

function ringContains(ring: number[][], lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    const hit =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

export function pointInAlberta(lon: number, lat: number): boolean {
  const g = ALBERTA_OUTLINE?.geometry;
  if (!g) return true;
  const polys: number[][][][] =
    g.type === "Polygon"
      ? [g.coordinates]
      : g.type === "MultiPolygon"
        ? g.coordinates
        : [];
  for (const poly of polys) {
    const outer = poly[0];
    if (!outer || !ringContains(outer, lon, lat)) continue;
    let hole = false;
    for (let i = 1; i < poly.length; i++) {
      if (ringContains(poly[i]!, lon, lat)) hole = true;
    }
    if (!hole) return true;
  }
  return false;
}

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
  const φ2 = Math.asin(sinφ1 * Math.cos(δ) + cosφ1 * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * cosφ1,
      Math.cos(δ) - sinφ1 * Math.sin(φ2),
    );
  return [((λ2 * 180) / Math.PI + 540) % 360 - 180, (φ2 * 180) / Math.PI];
}

function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

const ARROW_SHAFT_PX = 7.5;
const ARROW_HEAD_PX = 2.75;
/** Aim for this many screen pixels between neighboring shown sample arrows. */
const ARROW_TARGET_SPACING_PX = 40;

function nearestPow2(n: number): number {
  if (n <= 1) return 1;
  return 2 ** Math.round(Math.log2(n));
}

/** Power-of-two subsample so on-screen arrow density stays near the target. */
function arrowStride(
  zoom: number,
  lat: number,
  ncols: number,
  nrows: number,
): number {
  const spacingPx = WIND_FIELD_STEP_M / Math.max(metersPerPixel(lat, zoom), 1e-6);
  const maxStride = 2 ** Math.floor(Math.log2(Math.max(ncols, nrows, 2) - 1));
  return Math.min(maxStride, nearestPow2(ARROW_TARGET_SPACING_PX / spacingPx));
}

/** Shaft + V head, pointing where the wind is going. */
function simpleArrowGeometry(
  lon: number,
  lat: number,
  fromDeg: number,
  zoom: number,
): GeoJSON.MultiLineString {
  const mpx = metersPerPixel(lat, zoom);
  const shaftM = ARROW_SHAFT_PX * mpx;
  const headM = ARROW_HEAD_PX * mpx;
  const toBearing = (fromDeg + 180) % 360;
  const tip = destinationLngLat(lon, lat, shaftM, toBearing);
  const left = destinationLngLat(tip[0], tip[1], headM, toBearing + 148);
  const right = destinationLngLat(tip[0], tip[1], headM, toBearing - 148);
  return {
    type: "MultiLineString",
    coordinates: [
      [[lon, lat], tip],
      [left, tip],
      [right, tip],
    ],
  };
}

/**
 * One simple arrow per HRDPS sample (no interpolation). Direction is in the
 * line geometry. Zoomed-out views keep a nested subset (every 2nd, 4th, …).
 */
export function windArrowsGeoJSON(
  slice: WindFieldSlice,
  zoom: number,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  const midLat = (slice.north + slice.south) / 2;
  const stride = arrowStride(zoom, midLat, slice.ncols, slice.nrows);
  const originI = Math.floor((slice.ncols - 1) / 2);
  const originJ = Math.floor((slice.nrows - 1) / 2);
  for (let j = 0; j < slice.nrows; j++) {
    if (Math.abs(j - originJ) % stride !== 0) continue;
    for (let i = 0; i < slice.ncols; i++) {
      if (Math.abs(i - originI) % stride !== 0) continue;
      const cell = sampleCell(slice, i, j);
      if (!cell) continue;
      const lon = windGridLon(i);
      const lat = windGridLat(j);
      if (!pointInAlberta(lon, lat)) continue;
      features.push({
        type: "Feature",
        properties: {
          fromDeg: cell.d,
          speed: cell.s,
        },
        geometry: simpleArrowGeometry(lon, lat, cell.d, zoom),
      });
    }
  }
  return { type: "FeatureCollection", features };
}
