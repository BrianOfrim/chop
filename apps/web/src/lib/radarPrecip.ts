/** Lake / pin precipitation sampled from ECCC 1 km radar frames. */

import {
  RADAR_LEGEND_STOPS,
  RADAR_RAIN_SOURCE,
  RADAR_SNOW_SOURCE,
  RADAR_STYLE_RAIN,
  RADAR_STYLE_SNOW,
  formatRadarRate,
  resolveRadarFrame,
  sampleRadarLegend,
  type RadarWindows,
} from "./radar";

const GEOMET = "https://geo.weather.gc.ca/geomet";
const CONCURRENCY = 4;
const WET_RATE = 0.1;
const RGB_MAX_DIST2 = 48 * 48 * 3;
const CACHE_MAX = 240;
/** ~1 km pad so shoreline-edge pixels are inside the GetMap. */
const BBOX_PAD_DEG = 1 / 111;

export type RadarPrecipMode = "lake" | "pin";

export type LonLat = { lon: number; lat: number };

export type RadarPrecipBBox = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type RadarPrecipRaster = RadarPrecipBBox & {
  width: number;
  height: number;
  /** Row-major, north-first. 0 = dry / nodata. */
  values: Float32Array;
};

export type RadarPrecipFrame = {
  timeIso: string;
  rainMmH: number;
  snowCmH: number;
  mode: RadarPrecipMode;
  /** True while the 1 km raster for this frame is still fetching. */
  pending?: boolean;
};

type CacheEntry = { rain: RadarPrecipRaster; snow: RadarPrecipRaster };

const rasterCache = new Map<string, CacheEntry>();
let wcsEnabled: boolean | null = null;
let wcsLock: Promise<void> = Promise.resolve();

export function resetRadarPrecipCache(): void {
  rasterCache.clear();
  wcsEnabled = null;
  wcsLock = Promise.resolve();
}

function geometryRings(geom: GeoJSON.Geometry | null): GeoJSON.Position[][] {
  if (!geom) return [];
  if (geom.type === "Polygon") return geom.coordinates;
  if (geom.type === "MultiPolygon") return geom.coordinates.flat();
  return [];
}

function ringContains(lon: number, lat: number, ring: GeoJSON.Position[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    if (yi === yj) continue;
    if ((yi > lat) !== (yj > lat)) {
      const xInt = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (lon < xInt) inside = !inside;
    }
  }
  return inside;
}

export function pointInShoreline(
  lon: number,
  lat: number,
  shoreline: GeoJSON.FeatureCollection,
): boolean {
  let inside = false;
  for (const f of shoreline.features) {
    for (const ring of geometryRings(f.geometry)) {
      if (ringContains(lon, lat, ring)) inside = !inside;
    }
  }
  return inside;
}

export function shorelineBBox(
  shoreline: GeoJSON.FeatureCollection,
): RadarPrecipBBox | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const walk = (coords: unknown) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      west = Math.min(west, coords[0]);
      east = Math.max(east, coords[0]);
      south = Math.min(south, coords[1]);
      north = Math.max(north, coords[1]);
      return;
    }
    for (const c of coords) walk(c);
  };
  for (const f of shoreline.features) {
    for (const ring of geometryRings(f.geometry)) walk(ring);
  }
  if (!Number.isFinite(west)) return null;
  return {
    west: west - BBOX_PAD_DEG,
    south: south - BBOX_PAD_DEG,
    east: east + BBOX_PAD_DEG,
    north: north + BBOX_PAD_DEG,
  };
}

export function rasterSize(bbox: RadarPrecipBBox): { width: number; height: number } {
  const midLat = (bbox.south + bbox.north) / 2;
  const kmX = (bbox.east - bbox.west) * 111 * Math.cos((midLat * Math.PI) / 180);
  const kmY = (bbox.north - bbox.south) * 111;
  return {
    width: Math.max(8, Math.min(128, Math.round(kmX) || 8)),
    height: Math.max(8, Math.min(128, Math.round(kmY) || 8)),
  };
}

export function rgbToRadarRate(
  r: number,
  g: number,
  b: number,
  a = 255,
): number {
  if (a < 16) return 0;
  let best = 0;
  let bestD = Infinity;
  for (const stop of RADAR_LEGEND_STOPS) {
    const dr = r - stop.rgb[0];
    const dg = g - stop.rgb[1];
    const db = b - stop.rgb[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = stop.rate;
    }
  }
  return bestD > RGB_MAX_DIST2 ? 0 : best;
}

export function imageDataToRaster(
  data: { width: number; height: number; data: ArrayLike<number> },
  bbox: RadarPrecipBBox,
): RadarPrecipRaster {
  const { width, height } = data;
  const values = new Float32Array(width * height);
  for (let i = 0; i < values.length; i++) {
    const o = i * 4;
    values[i] = rgbToRadarRate(
      data.data[o]!,
      data.data[o + 1]!,
      data.data[o + 2]!,
      data.data[o + 3]!,
    );
  }
  return { ...bbox, width, height, values };
}

function cellIndex(
  raster: RadarPrecipRaster,
  lon: number,
  lat: number,
): number | null {
  const { west, south, east, north, width, height } = raster;
  if (east === west || north === south) return null;
  const i = Math.floor(((lon - west) / (east - west)) * width);
  const j = Math.floor(((north - lat) / (north - south)) * height);
  if (i < 0 || j < 0 || i >= width || j >= height) return null;
  return j * width + i;
}

export function sampleNearest(
  raster: RadarPrecipRaster,
  lon: number,
  lat: number,
): number {
  const idx = cellIndex(raster, lon, lat);
  if (idx == null) return 0;
  const v = raster.values[idx]!;
  return Number.isFinite(v) && v >= WET_RATE ? v : 0;
}

export function maxOverShoreline(
  raster: RadarPrecipRaster,
  shoreline: GeoJSON.FeatureCollection,
): number {
  const { west, south, east, north, width, height, values } = raster;
  if (east === west || north === south) return 0;
  let max = 0;
  for (let j = 0; j < height; j++) {
    const lat = north - ((j + 0.5) / height) * (north - south);
    for (let i = 0; i < width; i++) {
      const lon = west + ((i + 0.5) / width) * (east - west);
      if (!pointInShoreline(lon, lat, shoreline)) continue;
      const v = values[j * width + i]!;
      if (Number.isFinite(v) && v > max) max = v;
    }
  }
  return max >= WET_RATE ? max : 0;
}

export function reduceRadarPrecip(
  rain: RadarPrecipRaster,
  snow: RadarPrecipRaster,
  shoreline: GeoJSON.FeatureCollection,
  pin: LonLat | null,
): { rainMmH: number; snowCmH: number; mode: RadarPrecipMode } {
  if (pin) {
    return {
      rainMmH: sampleNearest(rain, pin.lon, pin.lat),
      snowCmH: sampleNearest(snow, pin.lon, pin.lat),
      mode: "pin",
    };
  }
  return {
    rainMmH: maxOverShoreline(rain, shoreline),
    snowCmH: maxOverShoreline(snow, shoreline),
    mode: "lake",
  };
}

export function radarRateToT(rate: number): number {
  if (!(rate > 0)) return 0;
  const last = RADAR_LEGEND_STOPS.length - 1;
  if (rate <= RADAR_LEGEND_STOPS[0]!.rate) return 0;
  if (rate >= RADAR_LEGEND_STOPS[last]!.rate) return 1;
  for (let i = 0; i < last; i++) {
    const a = RADAR_LEGEND_STOPS[i]!.rate;
    const b = RADAR_LEGEND_STOPS[i + 1]!.rate;
    if (rate <= b) {
      const u = b === a ? 0 : (rate - a) / (b - a);
      return (i + u) / last;
    }
  }
  return 1;
}

export type RadarPrecipKind = "rain" | "snow" | "dry";

export function dominantPrecip(
  rainMmH: number,
  snowCmH: number,
): { kind: RadarPrecipKind; rate: number } {
  if (rainMmH >= WET_RATE) return { kind: "rain", rate: rainMmH };
  if (snowCmH >= WET_RATE) return { kind: "snow", rate: snowCmH };
  return { kind: "dry", rate: 0 };
}

export function formatRadarSnowRate(rate: number): string {
  const n = rate < 10 ? Math.round(rate * 10) / 10 : Math.round(rate);
  const label = n < 1 || !Number.isInteger(n) ? n.toFixed(1) : String(n);
  return `${label} cm/h`;
}

export function formatRadarPrecipCopy(
  rainMmH: number,
  snowCmH: number,
  mode: RadarPrecipMode,
): string {
  const { kind, rate } = dominantPrecip(rainMmH, snowCmH);
  if (kind === "dry") return mode === "pin" ? "dry at pin" : "dry";
  const amount =
    kind === "snow" ? formatRadarSnowRate(rate) : formatRadarRate(rate);
  const label = `${amount} ${kind}`;
  if (mode === "pin") return `${label} at pin`;
  return `Lake max ${label}`;
}

export function precipBarFill(rainMmH: number, snowCmH: number): string | null {
  const { kind, rate } = dominantPrecip(rainMmH, snowCmH);
  if (kind === "dry") return null;
  const { rgb } = sampleRadarLegend(radarRateToT(rate));
  return `rgb(${rgb.join(",")})`;
}

function cacheKey(bbox: RadarPrecipBBox, timeIso: string): string {
  return [
    timeIso,
    bbox.west.toFixed(4),
    bbox.south.toFixed(4),
    bbox.east.toFixed(4),
    bbox.north.toFixed(4),
  ].join("|");
}

function remember(key: string, entry: CacheEntry): void {
  if (rasterCache.has(key)) rasterCache.delete(key);
  rasterCache.set(key, entry);
  while (rasterCache.size > CACHE_MAX) {
    const oldest = rasterCache.keys().next().value;
    if (oldest == null) break;
    rasterCache.delete(oldest);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}

function radarStyleForLayer(wmsLayer: string): string {
  return /snow|rsno/i.test(wmsLayer) ? RADAR_STYLE_SNOW : RADAR_STYLE_RAIN;
}

export function radarBboxMapUrl(
  wmsLayer: string,
  timeIso: string,
  bbox: RadarPrecipBBox,
  width: number,
  height: number,
): string {
  const style = radarStyleForLayer(wmsLayer);
  return (
    `${GEOMET}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap` +
    `&LAYERS=${encodeURIComponent(wmsLayer)}` +
    `&STYLES=${encodeURIComponent(style)}` +
    `&CRS=EPSG:4326` +
    `&BBOX=${bbox.south},${bbox.west},${bbox.north},${bbox.east}` +
    `&WIDTH=${width}&HEIGHT=${height}&FORMAT=image/png&TRANSPARENT=TRUE` +
    `&TIME=${encodeURIComponent(timeIso)}`
  );
}

function wcsUrl(
  coverageId: string,
  timeIso: string,
  bbox: RadarPrecipBBox,
): string {
  const q = new URLSearchParams({
    SERVICE: "WCS",
    VERSION: "2.0.1",
    REQUEST: "GetCoverage",
    COVERAGEID: coverageId,
    FORMAT: "image/tiff",
    SUBSETTINGCRS: "EPSG:4326",
    OUTPUTCRS: "EPSG:4326",
  });
  return (
    `${GEOMET}?${q}` +
    `&TIME=${encodeURIComponent(timeIso)}` +
    `&SUBSET=x(${bbox.west},${bbox.east})` +
    `&SUBSET=y(${bbox.south},${bbox.north})`
  );
}

async function fetchBuffer(url: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (attempt > 0) await delay(400 * 2 ** (attempt - 1));
    const res = await fetch(url, { signal });
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`Radar ${res.status}`);
      continue;
    }
    if (!res.ok) throw new Error(`Radar ${res.status}`);
    return res.arrayBuffer();
  }
  throw lastErr ?? new Error("Radar fetch failed");
}

function isWcsDisabled(): boolean {
  return wcsEnabled === false;
}

async function tryWcsRaster(
  coverageId: string,
  timeIso: string,
  bbox: RadarPrecipBBox,
  signal?: AbortSignal,
): Promise<RadarPrecipRaster | null> {
  if (isWcsDisabled()) return null;
  const prev = wcsLock;
  let unlock: () => void = () => {};
  wcsLock = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  await prev;
  if (isWcsDisabled()) {
    unlock();
    return null;
  }
  try {
    const buf = await fetchBuffer(wcsUrl(coverageId, timeIso, bbox), signal);
    const head = new Uint8Array(buf, 0, Math.min(buf.byteLength, 8));
    if (head[0] === 0x3c) {
      wcsEnabled = false;
      return null;
    }
    const { fromArrayBuffer } = await import("geotiff");
    const tiff = await fromArrayBuffer(buf);
    const image = await tiff.getImage();
    const gb = image.getBoundingBox();
    const rasters = await image.readRasters({ interleave: false });
    const band = Array.isArray(rasters) ? rasters[0] : rasters;
    if (!band || typeof band === "number") {
      wcsEnabled = false;
      return null;
    }
    const values = new Float32Array(band.length);
    for (let i = 0; i < band.length; i++) {
      const v = Number(band[i]);
      values[i] = Number.isFinite(v) && v >= WET_RATE ? v : 0;
    }
    wcsEnabled = true;
    return {
      west: gb[0]!,
      south: gb[1]!,
      east: gb[2]!,
      north: gb[3]!,
      width: image.getWidth(),
      height: image.getHeight(),
      values,
    };
  } catch {
    wcsEnabled = false;
    return null;
  } finally {
    unlock();
  }
}

async function pngToImageData(
  buf: ArrayBuffer,
  width: number,
  height: number,
): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const blob = new Blob([buf], { type: "image/png" });
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width || width;
  canvas.height = bmp.height || height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Radar canvas unavailable");
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

async function fetchWmsRaster(
  wmsLayer: string,
  timeIso: string,
  bbox: RadarPrecipBBox,
  size: { width: number; height: number },
  signal?: AbortSignal,
): Promise<RadarPrecipRaster> {
  const buf = await fetchBuffer(
    radarBboxMapUrl(wmsLayer, timeIso, bbox, size.width, size.height),
    signal,
  );
  const head = new Uint8Array(buf, 0, Math.min(buf.byteLength, 8));
  if (head[0] === 0x3c) {
    return {
      ...bbox,
      width: size.width,
      height: size.height,
      values: new Float32Array(size.width * size.height),
    };
  }
  const img = await pngToImageData(buf, size.width, size.height);
  return imageDataToRaster(img, bbox);
}

async function fetchLayerRaster(
  wmsLayer: string,
  timeIso: string,
  bbox: RadarPrecipBBox,
  size: { width: number; height: number },
  signal?: AbortSignal,
): Promise<RadarPrecipRaster> {
  const wcs = await tryWcsRaster(wmsLayer, timeIso, bbox, signal);
  if (wcs) return wcs;
  return fetchWmsRaster(wmsLayer, timeIso, bbox, size, signal);
}

export function sampleRadarPrecipSeries(
  times: string[],
  windows: RadarWindows | null,
  shoreline: GeoJSON.FeatureCollection,
  pin: LonLat | null,
): Array<RadarPrecipFrame | null> {
  const bbox = shorelineBBox(shoreline);
  if (!bbox || !windows) return times.map(() => null);
  return times.map((timeIso) => {
    const entry = rasterCache.get(cacheKey(bbox, timeIso));
    if (!entry) {
      return {
        timeIso,
        rainMmH: 0,
        snowCmH: 0,
        mode: pin ? "pin" : "lake",
        pending: true,
      };
    }
    const reduced = reduceRadarPrecip(entry.rain, entry.snow, shoreline, pin);
    return { timeIso, ...reduced };
  });
}

/**
 * Fetch rain/snow rasters for each 6-min frame over the lake bbox.
 * Pin changes only re-reduce cached rasters.
 */
export async function prefetchRadarPrecipRasters(
  times: string[],
  windows: RadarWindows,
  shoreline: GeoJSON.FeatureCollection,
  onProgress?: () => void,
  signal?: AbortSignal,
): Promise<void> {
  const bbox = shorelineBBox(shoreline);
  if (!bbox) return;
  const size = rasterSize(bbox);
  const missing = times.filter((iso) => !rasterCache.has(cacheKey(bbox, iso)));
  if (missing.length === 0) {
    onProgress?.();
    return;
  }
  await mapPool(
    missing,
    CONCURRENCY,
    async (timeIso) => {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const frame = resolveRadarFrame(Date.parse(timeIso), windows, false);
      if (frame.kind === "none" || !frame.timeIso) {
        const empty: RadarPrecipRaster = {
          ...bbox,
          width: size.width,
          height: size.height,
          values: new Float32Array(size.width * size.height),
        };
        remember(cacheKey(bbox, timeIso), { rain: empty, snow: empty });
        onProgress?.();
        return;
      }
      const rainLayer =
        frame.layers.find((l) => l.sourceId === RADAR_RAIN_SOURCE)?.wmsLayer ??
        frame.layers[1]?.wmsLayer;
      const snowLayer =
        frame.layers.find((l) => l.sourceId === RADAR_SNOW_SOURCE)?.wmsLayer ??
        frame.layers[0]?.wmsLayer;
      const [rain, snow] = await Promise.all([
        rainLayer
          ? fetchLayerRaster(rainLayer, frame.timeIso, bbox, size, signal)
          : Promise.resolve({
              ...bbox,
              width: size.width,
              height: size.height,
              values: new Float32Array(size.width * size.height),
            }),
        snowLayer
          ? fetchLayerRaster(snowLayer, frame.timeIso, bbox, size, signal)
          : Promise.resolve({
              ...bbox,
              width: size.width,
              height: size.height,
              values: new Float32Array(size.width * size.height),
            }),
      ]);
      remember(cacheKey(bbox, timeIso), { rain, snow });
      onProgress?.();
    },
    signal,
  );
}
