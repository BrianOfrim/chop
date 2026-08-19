import albertaMask from "../data/albertaMask.json";
import { DEFAULT_TEMP_SCALE, DEFAULT_WIND_SCALE } from "./colorScales";
import { sampleTempField, type TempFieldSlice } from "./tempField";
import { tempColor, TEMP_COLOR_MAX_C, TEMP_COLOR_MIN_C } from "./tempScale";
import { windColor, WIND_COLOR_MAX_MPS } from "./windScale";
import {
  WIND_FIELD_STEP_M,
  sampleWindField,
  windFieldExtent,
  windFieldSize,
  type WindFieldSlice,
} from "./windField";

export const WIND_CANVAS_SCALE = 8;

const ALBERTA_OUTLINE = (albertaMask as GeoJSON.FeatureCollection).features.find(
  (f) => f.properties?.kind === "outline",
);

/** Spherical Web Mercator Y — MapLibre stretches the canvas quad this way. */
function mercatorY(latDeg: number): number {
  const lat = Math.max(-85.051129, Math.min(85.051129, latDeg)) * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + lat / 2));
}

function latFromMercatorY(y: number): number {
  return ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
}

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
  const y =
    ((mercatorY(north) - mercatorY(lat)) /
      (mercatorY(north) - mercatorY(south))) *
    height;
  return [x, y];
}

function canvasPxToLonLat(
  x: number,
  y: number,
  width: number,
  height: number,
  west: number,
  south: number,
  east: number,
  north: number,
): { lon: number; lat: number } {
  const lon = west + (x / width) * (east - west);
  const v = y / height;
  const lat = latFromMercatorY(
    mercatorY(north) + v * (mercatorY(south) - mercatorY(north)),
  );
  return { lon, lat };
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

let albertaMaskCanvas: HTMLCanvasElement | null = null;

export function buildAlbertaWindMask(): HTMLCanvasElement {
  if (albertaMaskCanvas) return albertaMaskCanvas;
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
  albertaMaskCanvas = canvas;
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
  mode: "blend" | "edges" = "blend",
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
  const { west, south, east, north } = slice;
  for (let y = 0; y < height; y++) {
    const lat = canvasPxToLonLat(
      0.5,
      y + 0.5,
      width,
      height,
      west,
      south,
      east,
      north,
    ).lat;
    for (let x = 0; x < width; x++) {
      const lon = west + ((x + 0.5) / width) * (east - west);
      const sampled = sampleWindField(slice, lon, lat, mode);
      const s = sampled?.speedMps ?? Number.NaN;
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

export function paintTempField(
  ctx: CanvasRenderingContext2D,
  slice: TempFieldSlice,
  mask: HTMLCanvasElement,
  mode: "blend" | "edges" = "blend",
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
  const { west, south, east, north } = slice;
  for (let y = 0; y < height; y++) {
    const lat = canvasPxToLonLat(
      0.5,
      y + 0.5,
      width,
      height,
      west,
      south,
      east,
      north,
    ).lat;
    for (let x = 0; x < width; x++) {
      const lon = west + ((x + 0.5) / width) * (east - west);
      const t = sampleTempField(slice, lon, lat, mode) ?? Number.NaN;
      const o = (y * width + x) * 4;
      if (!Number.isFinite(t)) {
        px[o + 3] = 0;
        continue;
      }
      const [r, g, b, a] = tempColor(
        t,
        TEMP_COLOR_MIN_C,
        TEMP_COLOR_MAX_C,
        DEFAULT_TEMP_SCALE,
      );
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
/** Zoomed-in interpolated lattice (lake view). */
const ARROW_TARGET_SPACING_IN_PX = 40;
/** Zoomed-out interpolated lattice — tighter so Alberta isn’t sparse. */
const ARROW_TARGET_SPACING_OUT_PX = 18;

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

function latticeStep(slice: WindFieldSlice, zoom: number, spacingPx: number) {
  const midLat = (slice.north + slice.south) / 2;
  const mpx = Math.max(metersPerPixel(midLat, zoom), 1e-6);
  const dlat = (spacingPx * mpx) / 110_574;
  const dlon =
    (spacingPx * mpx) /
    (111_320 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180)));
  return { dlat, dlon };
}

function interpolatedArrowLattice(
  slice: WindFieldSlice,
  zoom: number,
  spacingPx: number,
): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = [];
  const { dlat, dlon } = latticeStep(slice, zoom, spacingPx);
  const south = slice.south + dlat * 0.5;
  const north = slice.north - dlat * 0.5;
  const west = slice.west + dlon * 0.5;
  const east = slice.east - dlon * 0.5;
  for (let lat = south; lat <= north; lat += dlat) {
    for (let lon = west; lon <= east; lon += dlon) {
      if (!pointInAlberta(lon, lat)) continue;
      const wind = sampleWindField(slice, lon, lat);
      if (!wind) continue;
      features.push({
        type: "Feature",
        properties: { fromDeg: wind.dirDeg, speed: wind.speedMps },
        geometry: simpleArrowGeometry(lon, lat, wind.dirDeg, zoom),
      });
    }
  }
  return features;
}

function integerStride(spacingPx: number, nativePx: number): number {
  return Math.max(1, Math.round(spacingPx / Math.max(nativePx, 1e-6)));
}

function nestedIndices(n: number, stride: number): number[] {
  const origin = Math.floor((n - 1) / 2);
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Math.abs(i - origin) % stride === 0) indices.push(i);
  }
  return indices;
}

function arrowFeatureAtCell(
  slice: WindFieldSlice,
  i: number,
  j: number,
  zoom: number,
): GeoJSON.Feature | null {
  const lon = slice.west + (i + 0.5) * slice.dlon;
  const lat = slice.north - (j + 0.5) * slice.dlat;
  if (!pointInAlberta(lon, lat)) return null;
  const cell = sampleCell(slice, i, j);
  const fromDeg = cell?.d;
  const speed = cell?.s;
  if (cell && Number.isFinite(fromDeg) && Number.isFinite(speed)) {
    return {
      type: "Feature",
      properties: { fromDeg, speed },
      geometry: simpleArrowGeometry(lon, lat, fromDeg, zoom),
    };
  }
  const wind = sampleWindField(slice, lon, lat);
  if (!wind) return null;
  return {
    type: "Feature",
    properties: { fromDeg: wind.dirDeg, speed: wind.speedMps },
    geometry: simpleArrowGeometry(lon, lat, wind.dirDeg, zoom),
  };
}

/**
 * Regular native-cell grid with a single integer stride on each axis.
 * Fractional steps (1 then 2 cells) look like missing rows/columns.
 */
function snappedNativeLattice(
  slice: WindFieldSlice,
  zoom: number,
  spacingPx: number,
): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = [];
  const midLat = (slice.north + slice.south) / 2;
  const mpx = Math.max(metersPerPixel(midLat, zoom), 1e-6);
  const nativePxY = (slice.dlat * 110_574) / mpx;
  const nativePxX =
    (slice.dlon * 111_320 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180))) /
    mpx;
  const cols = nestedIndices(slice.ncols, integerStride(spacingPx, nativePxX));
  const rows = nestedIndices(slice.nrows, integerStride(spacingPx, nativePxY));
  for (const j of rows) {
    for (const i of cols) {
      const feature = arrowFeatureAtCell(slice, i, j, zoom);
      if (feature) features.push(feature);
    }
  }
  return features;
}

function nativeCellArrows(
  slice: WindFieldSlice,
  zoom: number,
): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = [];
  for (let j = 0; j < slice.nrows; j++) {
    for (let i = 0; i < slice.ncols; i++) {
      const cell = sampleCell(slice, i, j);
      if (!cell) continue;
      const lon = slice.west + (i + 0.5) * slice.dlon;
      const lat = slice.north - (j + 0.5) * slice.dlat;
      if (!pointInAlberta(lon, lat)) continue;
      features.push({
        type: "Feature",
        properties: { fromDeg: cell.d, speed: cell.s },
        geometry: simpleArrowGeometry(lon, lat, cell.d, zoom),
      });
    }
  }
  return features;
}

/**
 * Regular grid. When native cells are smaller than the zoomed-out target,
 * use a single integer stride per axis (mixing 1- and 2-cell steps looks gappy).
 * When they are larger than the lake target, upsample onto a ~40 px lattice.
 * In between, every native cell gets an arrow.
 */
export function windArrowsGeoJSON(
  slice: WindFieldSlice,
  zoom: number,
): GeoJSON.FeatureCollection {
  const midLat = (slice.north + slice.south) / 2;
  const mpx = Math.max(metersPerPixel(midLat, zoom), 1e-6);
  const nativePx = WIND_FIELD_STEP_M / mpx;
  const features =
    nativePx < ARROW_TARGET_SPACING_OUT_PX
      ? snappedNativeLattice(slice, zoom, ARROW_TARGET_SPACING_OUT_PX)
      : nativePx <= ARROW_TARGET_SPACING_IN_PX
        ? nativeCellArrows(slice, zoom)
        : interpolatedArrowLattice(slice, zoom, ARROW_TARGET_SPACING_IN_PX);
  return { type: "FeatureCollection", features };
}
