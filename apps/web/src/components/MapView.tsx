import { useEffect, useMemo, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  type CanvasSource,
  type MapMouseEvent,
  type GeoJSONSource,
  type StyleSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  computeHsGrid,
  fetchAtDir,
  sampleGrid,
  type LakeGrids,
} from "@chop/wave-engine";
import type { ForecastPoint } from "./WaveChart";
import type { SpotProfile } from "../lib/lakeAssets";
import albertaMask from "../data/albertaMask.json";
import {
  depthMaxFromGrid,
  depthToImageData,
  hsToImageData,
  makeArrowIcon,
  HS_COLOR_MAX_M,
} from "../lib/hsOverlay";
import {
  buildShoreMaskCanvas,
  hsCanvasSize,
  paintHsClipped,
} from "../lib/shoreMask";
import { formatWind, formatWindMapLabel, type WindHour } from "../lib/wind";
import { windColorRgb } from "../lib/windScale";
import {
  formatDepth,
  formatWaveHeight,
  type UnitPrefs,
} from "../lib/units";
import { DEFAULT_DEPTH_SCALE, DEFAULT_WAVE_SCALE, scaleGradientCss } from "../lib/colorScales";
import type { GpxTrack } from "../lib/gpx";

type Props = {
  grids: LakeGrids;
  spot: SpotProfile;
  shoreline: GeoJSON.FeatureCollection;
  allShorelines?: GeoJSON.FeatureCollection | null;
  selectedLakeId: string;
  onSelectLake?: (id: string) => void;
  depthContours?: GeoJSON.FeatureCollection | null;
  wind: WindHour | null;
  units: UnitPrefs;
  simulating?: boolean;
  historic?: boolean;
  forecastPoint?: ForecastPoint | null;
  gpxTrack?: GpxTrack | null;
  /** Moving cursor along an uploaded track (session scrubber). */
  gpxCursor?: { lon: number; lat: number; headingDeg?: number | null } | null;
  /** Session points with HRDPS FROM direction, for perpendicular wind ticks. */
  gpxWindTicks?: Array<{ lon: number; lat: number; windDirDeg: number }> | null;
  gpxWindTickIndex?: number | null;
  /** Keep the selected GPX/session point centered while scrubbing. */
  followCursor?: boolean;
  onFollowCursorChange?: (on: boolean) => void;
  onChoosePoint?: (point: ForecastPoint) => void;
  onClearPoint?: () => void;
};

type HoverInfo = {
  lon: number;
  lat: number;
  x: number;
  y: number;
  hsM: number | null;
  depthM: number;
  fetchM: number | null;
  windSpeedMps: number | null;
  windDirDeg: number | null;
  gustMps: number | null;
};

type BasemapId = "map" | "satellite";
type OverlayId = "waves" | "depth";

const BASEMAP_KEY = "chop.basemap";
const OVERLAY_KEY = "chop.mapOverlay";

function loadBasemap(): BasemapId {
  try {
    return localStorage.getItem(BASEMAP_KEY) === "satellite" ? "satellite" : "map";
  } catch {
    return "map";
  }
}

function saveBasemap(id: BasemapId): void {
  try {
    localStorage.setItem(BASEMAP_KEY, id);
  } catch {
    // ignore quota / private mode
  }
}

function loadOverlay(): OverlayId {
  try {
    return localStorage.getItem(OVERLAY_KEY) === "depth" ? "depth" : "waves";
  } catch {
    return "waves";
  }
}

function saveOverlay(id: OverlayId): void {
  try {
    localStorage.setItem(OVERLAY_KEY, id);
  } catch {
    // ignore quota / private mode
  }
}

function lakeLineWidth(selectedId: string) {
  return [
    "case",
    ["==", ["get", "lakeId"], selectedId],
    2.8,
    1.25,
  ] as const;
}

function applyLakeHighlight(
  map: MapLibreMap,
  selectedId: string,
  satellite: boolean,
) {
  if (map.getLayer("lakes-all-fill")) {
    map.setPaintProperty("lakes-all-fill", "fill-opacity", [
      "case",
      ["==", ["get", "lakeId"], selectedId],
      satellite ? 0.05 : 0.1,
      satellite ? 0.14 : 0.2,
    ]);
  }
  if (map.getLayer("lakes-all-line")) {
    map.setPaintProperty(
      "lakes-all-line",
      "line-width",
      lakeLineWidth(selectedId),
    );
  }
}

function applyBasemap(
  map: MapLibreMap,
  id: BasemapId,
  selectedLakeId: string,
): void {
  if (map.getLayer("basemap-map")) {
    map.setLayoutProperty(
      "basemap-map",
      "visibility",
      id === "map" ? "visible" : "none",
    );
  }
  if (map.getLayer("basemap-satellite")) {
    map.setLayoutProperty(
      "basemap-satellite",
      "visibility",
      id === "satellite" ? "visible" : "none",
    );
  }
  if (map.getLayer("lakes-all-line")) {
    map.setPaintProperty(
      "lakes-all-line",
      "line-color",
      id === "satellite" ? "#f4f1ea" : "#163a44",
    );
  }
  if (map.getLayer("lakes-labels")) {
    map.setPaintProperty(
      "lakes-labels",
      "text-color",
      id === "satellite" ? "#f4f1ea" : "#163a44",
    );
    map.setPaintProperty(
      "lakes-labels",
      "text-halo-color",
      id === "satellite" ? "rgba(20, 28, 26, 0.72)" : "rgba(248, 246, 240, 0.9)",
    );
  }
  applyLakeHighlight(map, selectedLakeId, id === "satellite");
  if (map.getLayer("alberta-mask")) {
    map.setPaintProperty(
      "alberta-mask",
      "fill-color",
      id === "satellite" ? "#121614" : "#c5c2ba",
    );
    map.setPaintProperty(
      "alberta-mask",
      "fill-opacity",
      id === "satellite" ? 0.62 : 0.78,
    );
  }
  if (map.getLayer("alberta-outline")) {
    map.setPaintProperty(
      "alberta-outline",
      "line-color",
      id === "satellite" ? "#f4f1ea" : "#5c6a64",
    );
  }
}

/** Raster basemaps — Carto light + Esri World Imagery. Overlay layers are added after load. */
function makeStyle(basemap: BasemapId): StyleSpecification {
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      carto: {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
          "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
          "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        ],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      },
      satellite: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      },
    },
    layers: [
      {
        id: "basemap-satellite",
        type: "raster",
        source: "satellite",
        layout: { visibility: basemap === "satellite" ? "visible" : "none" },
        minzoom: 0,
        maxzoom: 22,
      },
      {
        id: "basemap-map",
        type: "raster",
        source: "carto",
        layout: { visibility: basemap === "map" ? "visible" : "none" },
        minzoom: 0,
        maxzoom: 20,
      },
    ],
  };
}

function hsCoordinates(meta: LakeGrids["meta"]): [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] {
  return [
    [meta.west, meta.north],
    [meta.east, meta.north],
    [meta.east, meta.south],
    [meta.west, meta.south],
  ];
}

function walkCoords(coords: unknown, acc: { w: number; s: number; e: number; n: number }) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    acc.w = Math.min(acc.w, coords[0]);
    acc.e = Math.max(acc.e, coords[0]);
    acc.s = Math.min(acc.s, coords[1]);
    acc.n = Math.max(acc.n, coords[1]);
    return;
  }
  for (const c of coords) walkCoords(c, acc);
}

function lakeBounds(
  meta: LakeGrids["meta"],
  shoreline: GeoJSON.FeatureCollection,
): [[number, number], [number, number]] {
  const acc = { w: meta.west, s: meta.south, e: meta.east, n: meta.north };
  for (const f of shoreline.features) {
    if (f.geometry) walkCoords(f.geometry.coordinates, acc);
  }
  return [
    [acc.w, acc.s],
    [acc.e, acc.n],
  ];
}

function fitLake(
  map: MapLibreMap,
  meta: LakeGrids["meta"],
  shoreline: GeoJSON.FeatureCollection,
  duration = 0,
) {
  const canvas = map.getCanvas();
  if (canvas.clientWidth < 8 || canvas.clientHeight < 8) return;
  map.fitBounds(lakeBounds(meta, shoreline), {
    padding: { top: 48, bottom: 80, left: 72, right: 72 },
    duration,
    maxZoom: 13,
  });
}

function geoBounds(
  fc: GeoJSON.FeatureCollection,
): [[number, number], [number, number]] | null {
  const acc = { w: Infinity, s: Infinity, e: -Infinity, n: -Infinity };
  for (const f of fc.features) {
    if (f.geometry) walkCoords(f.geometry.coordinates, acc);
  }
  if (!Number.isFinite(acc.w)) return null;
  return [
    [acc.w, acc.s],
    [acc.e, acc.n],
  ];
}

function fitFeatureCollection(
  map: MapLibreMap,
  fc: GeoJSON.FeatureCollection,
  duration = 0,
) {
  const canvas = map.getCanvas();
  if (canvas.clientWidth < 8 || canvas.clientHeight < 8) return;
  const bounds = geoBounds(fc);
  if (!bounds) return;
  map.fitBounds(bounds, {
    padding: { top: 48, bottom: 80, left: 72, right: 72 },
    duration,
    maxZoom: 13,
  });
}

function boundsByLakeId(
  fc: GeoJSON.FeatureCollection,
): Map<string, [[number, number], [number, number]]> {
  const boxes = new Map<
    string,
    { w: number; s: number; e: number; n: number }
  >();
  for (const f of fc.features) {
    const id = f.properties?.lakeId;
    if (typeof id !== "string" || !f.geometry) continue;
    let acc = boxes.get(id);
    if (!acc) {
      acc = { w: Infinity, s: Infinity, e: -Infinity, n: -Infinity };
      boxes.set(id, acc);
    }
    walkCoords(f.geometry.coordinates, acc);
  }
  const out = new Map<string, [[number, number], [number, number]]>();
  for (const [id, acc] of boxes) {
    if (!Number.isFinite(acc.w)) continue;
    out.set(id, [
      [acc.w, acc.s],
      [acc.e, acc.n],
    ]);
  }
  return out;
}

function fitBoundsPad(
  map: MapLibreMap,
  bounds: [[number, number], [number, number]],
  duration = 0,
) {
  const canvas = map.getCanvas();
  if (canvas.clientWidth < 8 || canvas.clientHeight < 8) return false;
  map.fitBounds(bounds, {
    padding: { top: 48, bottom: 80, left: 72, right: 72 },
    duration,
    maxZoom: 13,
  });
  return true;
}

function cloneFc(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  return JSON.parse(JSON.stringify(fc)) as GeoJSON.FeatureCollection;
}

const ALBERTA_MASK = albertaMask as GeoJSON.FeatureCollection;
const WIND_LABEL_PX = 18;

/** Keep the speed label below the 128px arrow icon at any zoom / rotation. */
function windLabelOffsetEms(zoom: number): [number, number] {
  const iconSize = 0.85 * 2 ** (zoom - 11);
  return [0, (64 * iconSize) / WIND_LABEL_PX + 0.55];
}

/** Place the wind arrow just east of the lake so it does not cover the Hs field. */
function windArrowLngLat(meta: LakeGrids["meta"]): [number, number] {
  const midLat = (meta.north + meta.south) / 2;
  const width = Math.max(meta.east - meta.west, 0.01);
  return [meta.east + width * 0.16, midLat];
}

/** Destination lon/lat after traveling `distanceM` along compass bearing (deg from N). */
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

/** Nearest-neighbor water test — better for shore finding than bilinear. */
function isWaterCell(
  depth: Float32Array,
  meta: LakeGrids["meta"],
  lon: number,
  lat: number,
): boolean {
  const { ncols, nrows, west, south, east, north, nodata } = meta;
  if (lon < west || lon > east || lat < south || lat > north) return false;
  const i = Math.min(
    ncols - 1,
    Math.max(0, Math.floor(((lon - west) / (east - west)) * ncols)),
  );
  const j = Math.min(
    nrows - 1,
    Math.max(0, Math.floor(((north - lat) / (north - south)) * nrows)),
  );
  const v = depth[j * ncols + i]!;
  return Number.isFinite(v) && v > 0 && v !== nodata;
}

function segIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): [number, number] | null {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const [x3, y3] = c;
  const [x4, y4] = d;
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-15) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

function ringIntersections(
  start: [number, number],
  end: [number, number],
  ring: number[][],
): [number, number][] {
  const hits: [number, number][] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i] as [number, number];
    const b = ring[i + 1] as [number, number];
    const hit = segIntersect(start, end, a, b);
    if (hit) hits.push(hit);
  }
  return hits;
}

function collectShoreHits(
  start: [number, number],
  end: [number, number],
  shoreline: GeoJSON.FeatureCollection,
): [number, number][] {
  const hits: [number, number][] = [];
  for (const f of shoreline.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "Polygon") {
      for (const ring of g.coordinates) hits.push(...ringIntersections(start, end, ring));
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.coordinates) {
        for (const ring of poly) hits.push(...ringIntersections(start, end, ring));
      }
    }
  }
  return hits;
}

function dist2(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/**
 * Walk upwind (FROM bearing) until we leave water, then snap to the
 * shoreline polygon so the ray visually reaches the shore.
 */
function findUpwindShorePoint(
  grids: LakeGrids,
  shoreline: GeoJSON.FeatureCollection,
  lon: number,
  lat: number,
  windFromDeg: number,
): [number, number] | null {
  const { meta, depth } = grids;
  const step = Math.max(meta.cellSizeM * 0.2, 10);
  const maxDist =
    Math.hypot(meta.east - meta.west, meta.north - meta.south) * 111_320 * 1.2;
  let lastWater: [number, number] = [lon, lat];
  let firstLand: [number, number] | null = null;
  let firstLandDist = 0;

  for (let d = step; d <= maxDist; d += step) {
    const p = destinationLngLat(lon, lat, d, windFromDeg);
    if (isWaterCell(depth, meta, p[0], p[1])) {
      lastWater = p;
      continue;
    }
    firstLand = p;
    firstLandDist = d;
    break;
  }
  if (!firstLand) {
    // Never left water on grid — fall back to far destination
    return destinationLngLat(lon, lat, maxDist * 0.5, windFromDeg);
  }

  // Binary refine water→land transition on the depth mask
  let lo = firstLandDist - step;
  let hi = firstLandDist;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const p = destinationLngLat(lon, lat, mid, windFromDeg);
    if (isWaterCell(depth, meta, p[0], p[1])) {
      lo = mid;
      lastWater = p;
    } else {
      hi = mid;
      firstLand = p;
    }
  }

  // Extend past the mask edge and intersect the shoreline geometry
  const past = destinationLngLat(lon, lat, hi + meta.cellSizeM * 2, windFromDeg);
  const hits = collectShoreHits([lon, lat], past, shoreline);
  if (hits.length > 0) {
    // Closest hit upwind of the hover point (along the ray, prefer farther from start
    // among hits near the transition — pick the first hit along the ray)
    hits.sort((a, b) => dist2([lon, lat], a) - dist2([lon, lat], b));
    return hits[0]!;
  }
  return firstLand ?? lastWater;
}

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const PERP_TICK_HALF_M = 90;
const PERP_TICK_ACTIVE_HALF_M = 150;
const TRAVEL_SHAFT_M = 130;

function perpTickCoords(
  lon: number,
  lat: number,
  windFromDeg: number,
  halfM: number,
): [number, number][] {
  const a = destinationLngLat(lon, lat, halfM, windFromDeg - 90);
  const b = destinationLngLat(lon, lat, halfM, windFromDeg + 90);
  return [a, b];
}

function travelArrowGeoJSON(
  lon: number,
  lat: number,
  headingDeg: number,
): GeoJSON.FeatureCollection {
  const tip = destinationLngLat(lon, lat, TRAVEL_SHAFT_M, headingDeg);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { kind: "travel-shaft" },
        geometry: {
          type: "LineString",
          coordinates: [
            [lon, lat],
            tip,
          ],
        },
      },
      {
        type: "Feature",
        properties: { kind: "travel-head", bearing: headingDeg },
        geometry: { type: "Point", coordinates: tip },
      },
    ],
  };
}

function windPerpTicksGeoJSON(
  ticks: Array<{ lon: number; lat: number; windDirDeg: number }>,
  activeIndex: number | null,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: ticks.map((t, i) => {
      const active = activeIndex != null && i === activeIndex;
      return {
        type: "Feature" as const,
        properties: { kind: active ? "perp-active" : "perp" },
        geometry: {
          type: "LineString" as const,
          coordinates: perpTickCoords(
            t.lon,
            t.lat,
            t.windDirDeg,
            active ? PERP_TICK_ACTIVE_HALF_M : PERP_TICK_HALF_M,
          ),
        },
      };
    }),
  };
}

function fetchRayGeoJSON(
  grids: LakeGrids,
  shoreline: GeoJSON.FeatureCollection,
  lon: number,
  lat: number,
  windFromDeg: number,
): GeoJSON.FeatureCollection {
  const end =
    findUpwindShorePoint(grids, shoreline, lon, lat, windFromDeg) ??
    ([lon, lat] as [number, number]);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { kind: "fetch-ray" },
        geometry: {
          type: "LineString",
          coordinates: [
            [lon, lat],
            end,
          ],
        },
      },
      {
        type: "Feature",
        properties: { kind: "hover" },
        geometry: { type: "Point", coordinates: [lon, lat] },
      },
      {
        type: "Feature",
        properties: { kind: "shore" },
        geometry: { type: "Point", coordinates: end },
      },
    ],
  };
}

export function MapView({
  grids,
  spot,
  shoreline,
  allShorelines = null,
  selectedLakeId,
  onSelectLake,
  depthContours = null,
  wind,
  units,
  simulating = false,
  historic = false,
  forecastPoint = null,
  gpxTrack = null,
  gpxCursor = null,
  gpxWindTicks = null,
  gpxWindTickIndex = null,
  followCursor = false,
  onFollowCursorChange,
  onChoosePoint,
  onClearPoint,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const hsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const shoreMaskRef = useRef<HTMLCanvasElement | null>(null);
  const hsRef = useRef<Float32Array | null>(null);
  const windRef = useRef<WindHour | null>(null);
  const gridsRef = useRef(grids);
  const shorelineRef = useRef(shoreline);
  const allShorelinesRef = useRef(allShorelines);
  const selectedLakeIdRef = useRef(selectedLakeId);
  const onSelectLakeRef = useRef(onSelectLake);
  const viewModeRef = useRef<"all" | "lake">("all");
  const fittedLakeIdRef = useRef(selectedLakeId);
  const boundsByLakeRef = useRef<
    Map<string, [[number, number], [number, number]]>
  >(new Map());
  const userMovedRef = useRef(false);
  const followCursorRef = useRef(followCursor);
  const onFollowCursorChangeRef = useRef(onFollowCursorChange);
  const followArmedRef = useRef(false);
  const onChoosePointRef = useRef(onChoosePoint);
  const onClearPointRef = useRef(onClearPoint);
  followCursorRef.current = followCursor;
  onFollowCursorChangeRef.current = onFollowCursorChange;
  onChoosePointRef.current = onChoosePoint;
  onClearPointRef.current = onClearPoint;
  onSelectLakeRef.current = onSelectLake;
  allShorelinesRef.current = allShorelines;
  selectedLakeIdRef.current = selectedLakeId;
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<BasemapId>(() =>
    typeof window !== "undefined" ? loadBasemap() : "map",
  );
  const [overlay, setOverlay] = useState<OverlayId>(() =>
    typeof window !== "undefined" ? loadOverlay() : "waves",
  );

  gridsRef.current = grids;
  shorelineRef.current = shoreline;

  const hs = useMemo(() => {
    if (!wind) return null;
    return computeHsGrid(grids, wind.windSpeedMps, wind.windDirDeg);
  }, [grids, wind]);

  hsRef.current = hs;
  windRef.current = wind;

  const vmax = HS_COLOR_MAX_M;
  const depthMaxM = useMemo(
    () => depthMaxFromGrid(grids.depth, grids.meta.nodata),
    [grids.depth, grids.meta.nodata],
  );
  const depthIntervalM = grids.meta.contourIntervalM ?? 1;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const { meta } = grids;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: makeStyle(loadBasemap()),
      center: [spot.identity.longitude, spot.identity.latitude],
      zoom: 11.2,
    });
    map.addControl(new NavigationControl({ visualizePitch: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      map.resize();

      map.addSource("alberta-mask", { type: "geojson", data: ALBERTA_MASK });
      map.addLayer({
        id: "alberta-mask",
        type: "fill",
        source: "alberta-mask",
        filter: ["==", ["get", "kind"], "mask"],
        paint: {
          "fill-color": "#c5c2ba",
          "fill-opacity": 0.78,
        },
      });
      map.addLayer({
        id: "alberta-outline",
        type: "line",
        source: "alberta-mask",
        filter: ["==", ["get", "kind"], "outline"],
        paint: {
          "line-color": "#5c6a64",
          "line-width": 1.15,
          "line-opacity": 0.85,
        },
      });

      map.addSource("shoreline", { type: "geojson", data: shoreline });
      map.addLayer({
        id: "shoreline-fill",
        type: "fill",
        source: "shoreline",
        layout: { visibility: "none" },
        paint: {
          "fill-color": "#0b3a4a",
          "fill-opacity": 0.06,
        },
      });
      map.addLayer({
        id: "shoreline-line",
        type: "line",
        source: "shoreline",
        layout: { visibility: "none" },
        paint: {
          "line-color": "#163a44",
          "line-width": 1.6,
        },
      });

      const lakesFc = allShorelinesRef.current;
      if (lakesFc) boundsByLakeRef.current = boundsByLakeId(lakesFc);
      map.addSource("lakes-all", {
        type: "geojson",
        data: lakesFc ? cloneFc(lakesFc) : EMPTY_FC,
      });
      map.addLayer({
        id: "lakes-all-fill",
        type: "fill",
        source: "lakes-all",
        paint: {
          "fill-color": "#0b3a4a",
          "fill-opacity": 0.18,
        },
      });
      map.addLayer({
        id: "lakes-all-line",
        type: "line",
        source: "lakes-all",
        paint: {
          "line-color": "#163a44",
          "line-width": lakeLineWidth(selectedLakeIdRef.current),
        },
      });
      map.addLayer({
        id: "lakes-labels",
        type: "symbol",
        source: "lakes-all",
        minzoom: 5,
        maxzoom: 11.2,
        layout: {
          "text-field": ["get", "name"],
          "text-size": 12,
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
          "text-variable-anchor": ["center", "top", "bottom"],
          "text-padding": 4,
          "text-optional": true,
        },
        paint: {
          "text-color": "#163a44",
          "text-halo-color": "rgba(248, 246, 240, 0.9)",
          "text-halo-width": 1.5,
        },
      });

      const canvas = document.createElement("canvas");
      const size = hsCanvasSize(meta);
      canvas.width = size.width;
      canvas.height = size.height;
      hsCanvasRef.current = canvas;
      shoreMaskRef.current = buildShoreMaskCanvas(meta, shoreline);
      map.addSource("hs", {
        type: "canvas",
        canvas,
        coordinates: hsCoordinates(meta),
        animate: true,
      });
      map.addLayer({
        id: "hs-layer",
        type: "raster",
        source: "hs",
        paint: {
          "raster-opacity": 0.92,
          "raster-resampling": "linear",
          "raster-fade-duration": 0,
        },
      });

      map.addSource("depth-contours", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "depth-contours",
        type: "line",
        source: "depth-contours",
        layout: { visibility: "none", "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
            "case",
            ["get", "major"],
            "rgba(8, 32, 64, 0.72)",
            "rgba(8, 32, 64, 0.38)",
          ],
          "line-width": ["case", ["get", "major"], 1.35, 0.7],
        },
      });
      map.addLayer({
        id: "depth-contour-labels",
        type: "symbol",
        source: "depth-contours",
        filter: ["==", ["get", "major"], true],
        layout: {
          visibility: "none",
          "symbol-placement": "line",
          "text-field": ["to-string", ["get", "depthM"]],
          "text-size": 11,
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
          "symbol-spacing": 220,
          "text-padding": 2,
          "text-max-angle": 35,
        },
        paint: {
          "text-color": "#0b2840",
          "text-halo-color": "rgba(248, 246, 240, 0.9)",
          "text-halo-width": 1.4,
        },
      });

      map.addSource("forecast-point", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "forecast-point-halo",
        type: "circle",
        source: "forecast-point",
        paint: {
          "circle-radius": 9,
          "circle-color": "#f8f6f0",
          "circle-opacity": 0.9,
          "circle-stroke-color": "#1c201e",
          "circle-stroke-width": 1.5,
        },
      });
      map.addLayer({
        id: "forecast-point-dot",
        type: "circle",
        source: "forecast-point",
        paint: {
          "circle-radius": 4,
          "circle-color": "#0f6b5c",
        },
      });

      map.addSource("fetch-ray", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "fetch-ray-line",
        type: "line",
        source: "fetch-ray",
        filter: ["==", ["get", "kind"], "fetch-ray"],
        paint: {
          "line-color": "#1c201e",
          "line-width": 2.2,
          "line-opacity": 0.9,
          "line-dasharray": [1.4, 1.1],
        },
      });
      map.addLayer({
        id: "fetch-ray-points",
        type: "circle",
        source: "fetch-ray",
        filter: ["in", ["get", "kind"], ["literal", ["hover", "shore"]]],
        paint: {
          "circle-radius": [
            "match",
            ["get", "kind"],
            "hover",
            4.5,
            3.5,
          ],
          "circle-color": [
            "match",
            ["get", "kind"],
            "hover",
            "#1c201e",
            "#f8f6f0",
          ],
          "circle-stroke-color": "#1c201e",
          "circle-stroke-width": 1.5,
        },
      });

      if (!map.hasImage("wind-arrow")) {
        map.addImage("wind-arrow", makeArrowIcon(128), { sdf: true });
      }

      map.addSource("wind-dir", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "wind-dir",
        type: "symbol",
        source: "wind-dir",
        layout: {
          "icon-image": "wind-arrow",
          // Scale ~2× per zoom so the arrow keeps roughly constant ground size
          "icon-size": [
            "interpolate",
            ["exponential", 2],
            ["zoom"],
            9,
            0.21,
            11,
            0.85,
            13,
            3.4,
            15,
            13.6,
          ],
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": ["get", "label"],
          "text-size": WIND_LABEL_PX,
          "text-anchor": "top",
          "text-offset": windLabelOffsetEms(map.getZoom()),
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "icon-color": ["get", "color"],
          "icon-halo-color": "rgba(255,255,255,0.92)",
          "icon-halo-width": 1.4,
          "text-color": ["get", "color"],
          "text-halo-color": "rgba(255,255,255,0.92)",
          "text-halo-width": 1.8,
        },
      });

      map.addSource("gpx-track", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "gpx-track-casing",
        type: "line",
        source: "gpx-track",
        filter: ["in", ["get", "kind"], ["literal", ["track", "route"]]],
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#f8f6f0",
          "line-width": 6.5,
          "line-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "gpx-track-line",
        type: "line",
        source: "gpx-track",
        filter: ["in", ["get", "kind"], ["literal", ["track", "route"]]],
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#c45c1a",
          "line-width": 3.2,
          "line-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "gpx-track-ends",
        type: "circle",
        source: "gpx-track",
        filter: ["in", ["get", "kind"], ["literal", ["start", "end"]]],
        paint: {
          "circle-radius": [
            "match",
            ["get", "kind"],
            "start",
            5.5,
            4.5,
          ],
          "circle-color": [
            "match",
            ["get", "kind"],
            "start",
            "#1f6f78",
            "#c45c1a",
          ],
          "circle-stroke-color": "#f8f6f0",
          "circle-stroke-width": 2,
        },
      });

      map.addSource("gpx-wind-perp", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "gpx-wind-perp",
        type: "line",
        source: "gpx-wind-perp",
        filter: ["==", ["get", "kind"], "perp"],
        layout: {
          "line-cap": "butt",
          "line-join": "round",
        },
        paint: {
          "line-color": "#1f6f78",
          "line-width": 1.35,
          "line-dasharray": [0.7, 1.35],
          "line-opacity": 0.55,
        },
      });
      map.addLayer({
        id: "gpx-wind-perp-active",
        type: "line",
        source: "gpx-wind-perp",
        filter: ["==", ["get", "kind"], "perp-active"],
        layout: {
          "line-cap": "butt",
          "line-join": "round",
        },
        paint: {
          "line-color": "#1f6f78",
          "line-width": 2.1,
          "line-dasharray": [1, 1.15],
          "line-opacity": 0.95,
        },
      });

      map.addSource("gpx-cursor", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "gpx-cursor-halo",
        type: "circle",
        source: "gpx-cursor",
        paint: {
          "circle-radius": 10,
          "circle-color": "#f8f6f0",
          "circle-opacity": 0.92,
          "circle-stroke-color": "#1c201e",
          "circle-stroke-width": 1.5,
        },
      });
      map.addLayer({
        id: "gpx-cursor-dot",
        type: "circle",
        source: "gpx-cursor",
        paint: {
          "circle-radius": 4.5,
          "circle-color": "#c45c1a",
        },
      });

      map.addSource("gpx-travel", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "gpx-travel-shaft",
        type: "line",
        source: "gpx-travel",
        filter: ["==", ["get", "kind"], "travel-shaft"],
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#c45c1a",
          "line-width": 2.4,
          "line-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "gpx-travel-head",
        type: "symbol",
        source: "gpx-travel",
        filter: ["==", ["get", "kind"], "travel-head"],
        layout: {
          "icon-image": "wind-arrow",
          "icon-size": 0.22,
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-color": "#c45c1a",
          "icon-halo-color": "rgba(248, 246, 240, 0.95)",
          "icon-halo-width": 1.6,
        },
      });

      applyBasemap(map, loadBasemap(), selectedLakeIdRef.current);
      const overview = allShorelinesRef.current;
      if (overview && overview.features.length > 0) {
        fitFeatureCollection(map, overview, 0);
        viewModeRef.current = "all";
        fittedLakeIdRef.current = selectedLakeIdRef.current;
      } else {
        fitLake(map, meta, shoreline, 0);
        viewModeRef.current = "lake";
      }
      setReady(true);
    });

    map.on("movestart", (e) => {
      if (!e.originalEvent) return;
      userMovedRef.current = true;
      if (followCursorRef.current) onFollowCursorChangeRef.current?.(false);
    });

    map.on("mousemove", (e: MapMouseEvent) => {
      const { lng, lat } = e.lngLat;
      const g = gridsRef.current;
      const depthM = sampleGrid(g.depth, g.meta, lng, lat);
      if (depthM == null || depthM <= 0) {
        setHover(null);
        return;
      }
      const currentHs = hsRef.current;
      const currentWind = windRef.current;
      const hsM = currentHs ? sampleGrid(currentHs, g.meta, lng, lat) : null;
      let fetchM: number | null = null;
      if (currentWind) {
        const { ncols, nrows, west, south, east, north } = g.meta;
        const fx = ((lng - west) / (east - west)) * ncols;
        const fy = ((north - lat) / (north - south)) * nrows;
        const i = Math.min(ncols - 1, Math.max(0, Math.floor(fx)));
        const j = Math.min(nrows - 1, Math.max(0, Math.floor(fy)));
        const idx = j * ncols + i;
        if (g.depth[idx]! > 0) {
          fetchM = fetchAtDir(g.fetch, g.meta, idx, currentWind.windDirDeg);
        }
      }
      setHover({
        lon: lng,
        lat,
        x: e.point.x,
        y: e.point.y,
        hsM,
        depthM,
        fetchM,
        windSpeedMps: currentWind?.windSpeedMps ?? null,
        windDirDeg: currentWind?.windDirDeg ?? null,
        gustMps: currentWind?.gustMps ?? null,
      });
    });

    map.on("click", (e: MapMouseEvent) => {
      const layers = ["lakes-all-fill", "lakes-all-line", "lakes-labels"].filter(
        (id) => map.getLayer(id),
      );
      const pad = 10;
      const hits = map.queryRenderedFeatures(
        [
          { x: e.point.x - pad, y: e.point.y - pad },
          { x: e.point.x + pad, y: e.point.y + pad },
        ],
        { layers },
      );
      const selected = selectedLakeIdRef.current;
      const other = hits.find((f) => {
        const id = f.properties?.lakeId;
        return typeof id === "string" && id !== selected;
      });
      if (other?.properties?.lakeId) {
        const id = String(other.properties.lakeId);
        const bounds = boundsByLakeRef.current.get(id);
        if (bounds) {
          viewModeRef.current = "lake";
          fittedLakeIdRef.current = id;
          userMovedRef.current = false;
          fitBoundsPad(map, bounds, 800);
        }
        onSelectLakeRef.current?.(id);
        return;
      }
      const { lng, lat } = e.lngLat;
      const g = gridsRef.current;
      const depthM = sampleGrid(g.depth, g.meta, lng, lat);
      if (depthM == null || depthM <= 0) return;
      onChoosePointRef.current?.({ lon: lng, lat });
    });

    map.on("mouseenter", "lakes-all-fill", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "lakes-all-fill", () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("mouseout", () => setHover(null));

    const syncWindLabelOffset = () => {
      if (!map.getLayer("wind-dir")) return;
      map.setLayoutProperty("wind-dir", "text-offset", windLabelOffsetEms(map.getZoom()));
    };
    map.on("zoom", syncWindLabelOffset);

    const refitIfNeeded = () => {
      map.resize();
      if (followCursorRef.current || userMovedRef.current) return;
      if (viewModeRef.current === "all" && allShorelinesRef.current) {
        fitFeatureCollection(map, allShorelinesRef.current, 0);
        return;
      }
      const bounds = boundsByLakeRef.current.get(selectedLakeIdRef.current);
      if (bounds) {
        fitBoundsPad(map, bounds, 0);
        return;
      }
      fitLake(map, gridsRef.current.meta, shorelineRef.current, 0);
    };
    const onResize = () => refitIfNeeded();
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(refitIfNeeded);
    ro.observe(containerRef.current);

    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      hsCanvasRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move shoreline, Hs georef, and camera when the active lake changes
  useEffect(() => {
    const map = mapRef.current;
    const canvas = hsCanvasRef.current;
    if (!map || !ready || !canvas) return;

    const showOverlay = spot.spotId === selectedLakeId;
    if (map.getLayer("hs-layer")) {
      map.setLayoutProperty(
        "hs-layer",
        "visibility",
        showOverlay ? "visible" : "none",
      );
    }

    const shoreSrc = map.getSource("shoreline") as GeoJSONSource | undefined;
    if (showOverlay) {
      shoreSrc?.setData(shoreline);

      const { meta } = grids;
      const size = hsCanvasSize(meta);
      if (canvas.width !== size.width || canvas.height !== size.height) {
        canvas.width = size.width;
        canvas.height = size.height;
      }
      shoreMaskRef.current = buildShoreMaskCanvas(meta, shoreline);
      const hsSrc = map.getSource("hs") as CanvasSource | undefined;
      hsSrc?.setCoordinates(hsCoordinates(meta));
    }

    applyLakeHighlight(map, selectedLakeId, basemap === "satellite");
  }, [grids, shoreline, selectedLakeId, ready, spot.spotId, basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (fittedLakeIdRef.current === selectedLakeId) return;
    const bounds = boundsByLakeRef.current.get(selectedLakeId);
    if (!bounds) return;
    fittedLakeIdRef.current = selectedLakeId;
    userMovedRef.current = false;
    viewModeRef.current = "lake";
    fitBoundsPad(map, bounds, 800);
  }, [selectedLakeId, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!allShorelines) return;
    boundsByLakeRef.current = boundsByLakeId(allShorelines);
    if (!map || !ready) return;
    const src = map.getSource("lakes-all") as GeoJSONSource | undefined;
    src?.setData(cloneFc(allShorelines));
    if (!userMovedRef.current && viewModeRef.current === "all") {
      fitFeatureCollection(map, allShorelines, 0);
    }
  }, [allShorelines, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    applyBasemap(map, basemap, selectedLakeId);
    saveBasemap(basemap);
  }, [basemap, ready, selectedLakeId]);

  // Draw upwind fetch ray from hover point to shoreline
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("fetch-ray") as GeoJSONSource | undefined;
    if (!src) return;
    if (!hover || hover.windDirDeg == null || hover.fetchM == null || hover.fetchM <= 0) {
      src.setData(EMPTY_FC);
      return;
    }
    src.setData(
      fetchRayGeoJSON(
        gridsRef.current,
        shorelineRef.current,
        hover.lon,
        hover.lat,
        hover.windDirDeg,
      ),
    );
  }, [hover, ready]);

  useEffect(() => {
    const canvas = hsCanvasRef.current;
    if (!ready || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const size = hsCanvasSize(grids.meta);
    if (canvas.width !== size.width || canvas.height !== size.height) {
      canvas.width = size.width;
      canvas.height = size.height;
    }
    let mask = shoreMaskRef.current;
    if (!mask || mask.width !== size.width || mask.height !== size.height) {
      mask = buildShoreMaskCanvas(grids.meta, shorelineRef.current);
      shoreMaskRef.current = mask;
    }
    if (spot.spotId !== selectedLakeId) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    if (overlay === "depth") {
      paintHsClipped(
        ctx,
        depthToImageData(grids.depth, grids.meta, depthMaxM, DEFAULT_DEPTH_SCALE),
        mask,
      );
      return;
    }
    if (!hs) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    paintHsClipped(
      ctx,
      hsToImageData(hs, grids.meta, vmax, DEFAULT_WAVE_SCALE),
      mask,
    );
  }, [hs, overlay, ready, grids, vmax, depthMaxM, spot.spotId, selectedLakeId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("depth-contours") as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(
      overlay === "depth" && depthContours ? depthContours : EMPTY_FC,
    );
    const vis =
      overlay === "depth" && spot.spotId === selectedLakeId ? "visible" : "none";
    if (map.getLayer("depth-contours")) {
      map.setLayoutProperty("depth-contours", "visibility", vis);
    }
    if (map.getLayer("depth-contour-labels")) {
      map.setLayoutProperty("depth-contour-labels", "visibility", vis);
    }
  }, [overlay, depthContours, ready, spot.spotId, selectedLakeId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("wind-dir") as GeoJSONSource | undefined;
    if (!src) return;
    if (!wind || spot.spotId !== selectedLakeId) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    // Arrow offset east of the lake; points where the wind is going (TO)
    const toBearing = (wind.windDirDeg + 180) % 360;
    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            bearing: toBearing,
            label: formatWindMapLabel(wind.windSpeedMps, wind.gustMps, units.wind),
            color: windColorRgb(wind.windSpeedMps),
          },
          geometry: {
            type: "Point",
            coordinates: windArrowLngLat(grids.meta),
          },
        },
      ],
    });
  }, [wind, ready, grids.meta, units.wind, spot.spotId, selectedLakeId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("forecast-point") as GeoJSONSource | undefined;
    if (!src) return;
    if (!forecastPoint) {
      src.setData(EMPTY_FC);
      return;
    }
    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Point",
            coordinates: [forecastPoint.lon, forecastPoint.lat],
          },
        },
      ],
    });
  }, [forecastPoint, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("gpx-track") as GeoJSONSource | undefined;
    if (!src) return;
    if (!gpxTrack) {
      src.setData(EMPTY_FC);
      return;
    }
    src.setData(gpxTrack.geojson);
    if (followCursorRef.current) return;
    const { west, south, east, north } = gpxTrack.bounds;
    if (
      Number.isFinite(west) &&
      Number.isFinite(south) &&
      Number.isFinite(east) &&
      Number.isFinite(north)
    ) {
      userMovedRef.current = true;
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 56, maxZoom: 14, duration: 650 },
      );
    }
  }, [gpxTrack, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("gpx-cursor") as GeoJSONSource | undefined;
    const travelSrc = map.getSource("gpx-travel") as GeoJSONSource | undefined;
    if (!src) return;
    if (!gpxCursor) {
      src.setData(EMPTY_FC);
      travelSrc?.setData(EMPTY_FC);
      return;
    }
    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Point",
            coordinates: [gpxCursor.lon, gpxCursor.lat],
          },
        },
      ],
    });
    const heading = gpxCursor.headingDeg;
    if (
      travelSrc &&
      heading != null &&
      Number.isFinite(heading)
    ) {
      travelSrc.setData(
        travelArrowGeoJSON(gpxCursor.lon, gpxCursor.lat, heading),
      );
    } else {
      travelSrc?.setData(EMPTY_FC);
    }
  }, [gpxCursor, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!followCursor || !gpxCursor || !map || !ready) {
      if (!followCursor) followArmedRef.current = false;
      return;
    }
    userMovedRef.current = true;
    const armed = followArmedRef.current;
    followArmedRef.current = true;
    const center: [number, number] = [gpxCursor.lon, gpxCursor.lat];
    if (!armed) {
      map.easeTo({
        center,
        zoom: Math.max(map.getZoom(), 14),
        duration: 420,
        essential: true,
      });
      return;
    }
    map.jumpTo({ center });
  }, [followCursor, gpxCursor?.lon, gpxCursor?.lat, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("gpx-wind-perp") as GeoJSONSource | undefined;
    if (!src) return;
    if (!gpxWindTicks || gpxWindTicks.length === 0) {
      src.setData(EMPTY_FC);
      return;
    }
    src.setData(windPerpTicksGeoJSON(gpxWindTicks, gpxWindTickIndex ?? null));
  }, [gpxWindTicks, gpxWindTickIndex, ready]);

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      <div className="basemap-toggle overlay-toggle" role="group" aria-label="Lake overlay">
        <button
          type="button"
          className={overlay === "waves" ? "is-on" : ""}
          aria-pressed={overlay === "waves"}
          onClick={() => {
            setOverlay("waves");
            saveOverlay("waves");
          }}
        >
          Waves
        </button>
        <button
          type="button"
          className={overlay === "depth" ? "is-on" : ""}
          aria-pressed={overlay === "depth"}
          onClick={() => {
            setOverlay("depth");
            saveOverlay("depth");
          }}
        >
          Depth
        </button>
      </div>
      <div className="basemap-toggle" role="group" aria-label="Basemap">
        <button
          type="button"
          className={basemap === "map" ? "is-on" : ""}
          aria-pressed={basemap === "map"}
          onClick={() => setBasemap("map")}
        >
          Map
        </button>
        <button
          type="button"
          className={basemap === "satellite" ? "is-on" : ""}
          aria-pressed={basemap === "satellite"}
          onClick={() => setBasemap("satellite")}
        >
          Satellite
        </button>
      </div>
      <div className="legend">
        <div className="legend-title">
          {overlay === "depth" ? "Depth" : "Wave height Hs"}
        </div>
        <div
          className="legend-bar"
          style={{
            background: scaleGradientCss(
              overlay === "depth" ? DEFAULT_DEPTH_SCALE : DEFAULT_WAVE_SCALE,
            ),
          }}
        />
        <div className="legend-scale">
          <span>
            {overlay === "depth" ? formatDepth(0, units.wave) : "0"}
          </span>
          <span>
            {overlay === "depth"
              ? formatDepth(depthMaxM, units.wave)
              : formatWaveHeight(vmax, units.wave)}
          </span>
        </div>
        <p className="legend-note">
          {overlay === "depth"
            ? `Shallow (light) to deep (dark). ${depthIntervalM} m contours.`
            : simulating
              ? "SMB fetch-limited + depth cap. Wind: simulator."
              : gpxCursor
                ? "SMB fetch-limited + depth cap. Wind: HRDPS (session)."
                : historic
                  ? "SMB fetch-limited + depth cap. Wind: HRDPS (history)."
                  : "SMB fetch-limited + depth cap. Wind: HRDPS."}
        </p>
        {forecastPoint ? (
          <button type="button" className="legend-pin-btn" onClick={() => onClearPoint?.()}>
            Pinned spot · Clear
          </button>
        ) : (
          <p className="legend-note">Click the lake to pin a forecast spot.</p>
        )}
      </div>
      {hover && (
        <div
          className="hover-card"
          style={{
            left: Math.min(hover.x + 14, (containerRef.current?.clientWidth ?? 320) - 180),
            top: Math.max(8, hover.y - 8),
          }}
        >
          <div className="hover-primary">
            Wave{" "}
            {hover.hsM != null && Number.isFinite(hover.hsM)
              ? formatWaveHeight(hover.hsM, units.wave)
              : "—"}
          </div>
          <div className="hover-primary">
            Wind{" "}
            {hover.windSpeedMps != null && hover.windDirDeg != null
              ? formatWind(
                  hover.windSpeedMps,
                  hover.windDirDeg,
                  hover.gustMps,
                  units.wind,
                )
              : "—"}
          </div>
          <div className="hover-meta">
            Depth {formatDepth(hover.depthM, units.wave)}
            {hover.fetchM != null ? ` · Fetch ${(hover.fetchM / 1000).toFixed(1)} km` : ""}
          </div>
        </div>
      )}
    </div>
  );
}
