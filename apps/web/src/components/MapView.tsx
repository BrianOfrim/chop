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
  computeHsGridFromWind,
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
import { formatWind, type WindHour } from "../lib/wind";
import { WIND_COLOR_MAX_MPS } from "../lib/windScale";
import {
  inWindFieldExtent,
  sampleWindField,
  windFieldExtent,
  type WindFieldSlice,
} from "../lib/windField";
import { drawLakeOutlines, polygonRings } from "../lib/lakeOutlines";
import {
  buildAlbertaWindMask,
  paintTempField,
  paintWindField,
  windCanvasCoordinates,
  windCanvasSize,
} from "../lib/windOverlay";
import {
  clearParticleCanvas,
  createParticleField,
  drawWindArrows,
  layoutWindArrows,
  prefersReducedWindMotion,
  stepWindParticles,
  syncGlyphLiftCanvas,
  WIND_STREAK_COLOR,
} from "../lib/windParticles";
import {
  celsiusToTemp,
  formatDepth,
  formatTemp,
  formatWaveHeight,
  formatWindSpeed,
  metersToWave,
  mpsToWind,
  tempUnitLabel,
  waveUnitLabel,
  windUnitLabel,
  type UnitPrefs,
} from "../lib/units";
import { DEFAULT_DEPTH_SCALE, DEFAULT_TEMP_SCALE, DEFAULT_WAVE_SCALE, DEFAULT_WIND_SCALE, sampleRgb, scaleGradientCss, type ColorScaleId } from "../lib/colorScales";
import type { GpxTrack } from "../lib/gpx";
import {
  type StationFeature,
  type StationsResponse,
  stationNetworkLabel,
} from "../lib/stations";
import {
  formatRadarLegend,
  formatRadarRate,
  formatRadarTick,
  RADAR_ATTRIBUTION,
  RADAR_LEGEND_TICK_RATES,
  RADAR_OBS_LAYERS,
  RADAR_RAIN_SOURCE,
  radarLegendGradientCss,
  radarTileUrl,
  resolveRadarFrame,
  sampleRadarLegend,
  type RadarFrame,
  type RadarWindows,
} from "../lib/radar";
import type { WindMode } from "../lib/historyRange";
import {
  sampleTempField,
  type TempFieldSlice,
} from "../lib/tempField";
import { TEMP_COLOR_MAX_C, TEMP_COLOR_MIN_C } from "../lib/tempScale";

export type OverlayId = "waves" | "depth" | "wind" | "temp";
export type BasemapId = "map" | "satellite" | "topo";
export type WindGlyphId = "arrows" | "particles";
type HeatmapStyle = "blend" | "edges";

function showsWindHeatmap(overlay: OverlayId, radarOn = false): boolean {
  return !radarOn && overlay === "wind";
}

function showsTempHeatmap(overlay: OverlayId, radarOn = false): boolean {
  return !radarOn && overlay === "temp";
}

function showsFieldHeatmap(overlay: OverlayId, radarOn = false): boolean {
  return showsWindHeatmap(overlay, radarOn) || showsTempHeatmap(overlay, radarOn);
}

function showsWindGlyphs(overlay: OverlayId, radarOn = false): boolean {
  return radarOn || overlay === "waves" || overlay === "wind" || overlay === "temp";
}

const LEGEND_TICK_COUNT = 5;

function legendStops(min: number, max: number, count = LEGEND_TICK_COUNT): number[] {
  if (count < 2) return [min, max];
  return Array.from(
    { length: count },
    (_, i) => min + ((max - min) * i) / (count - 1),
  );
}

function formatLegendTick(
  overlay: OverlayId,
  value: number,
  units: UnitPrefs,
): string {
  if (overlay === "depth") {
    const v = units.wave === "ft" ? value * 3.28084 : value;
    return v.toFixed(v >= 10 ? 0 : 1);
  }
  if (overlay === "wind") {
    const v = mpsToWind(value, units.wind);
    return v.toFixed(units.wind === "mps" ? 1 : 0);
  }
  if (overlay === "temp") {
    return celsiusToTemp(value, units.temp).toFixed(0);
  }
  const v = metersToWave(value, units.wave);
  if (units.wave === "m") return v.toFixed(2);
  if (units.wave === "ft") return v.toFixed(1);
  return v.toFixed(0);
}

function legendUnit(overlay: OverlayId, units: UnitPrefs): string {
  if (overlay === "wind") return windUnitLabel(units.wind);
  if (overlay === "temp") return tempUnitLabel(units.temp);
  if (overlay === "depth") return units.wave === "ft" ? "ft" : "m";
  return waveUnitLabel(units.wave);
}

function legendScale(overlay: OverlayId): ColorScaleId {
  if (overlay === "depth") return DEFAULT_DEPTH_SCALE;
  if (overlay === "wind") return DEFAULT_WIND_SCALE;
  if (overlay === "temp") return DEFAULT_TEMP_SCALE;
  return DEFAULT_WAVE_SCALE;
}

function legendRange(
  overlay: OverlayId,
  depthMaxM: number,
  vmax: number,
): { min: number; max: number } {
  if (overlay === "temp") return { min: TEMP_COLOR_MIN_C, max: TEMP_COLOR_MAX_C };
  if (overlay === "wind") return { min: 0, max: WIND_COLOR_MAX_MPS };
  if (overlay === "depth") return { min: 0, max: depthMaxM };
  return { min: 0, max: vmax };
}

function formatLegendHover(
  overlay: OverlayId,
  value: number,
  units: UnitPrefs,
): string {
  if (overlay === "depth") return formatDepth(value, units.wave);
  if (overlay === "wind") return formatWindSpeed(value, units.wind);
  if (overlay === "temp") return formatTemp(value, units.temp);
  return formatWaveHeight(value, units.wave);
}

type Props = {
  grids: LakeGrids | null;
  spot: SpotProfile | null;
  shoreline: GeoJSON.FeatureCollection | null;
  allShorelines?: GeoJSON.FeatureCollection | null;
  selectedLakeId: string | null;
  onSelectLake?: (id: string) => void;
  depthContours?: GeoJSON.FeatureCollection | null;
  wind: WindHour | null;
  /** Wind-event duration (s); omit for fetch-limited / sim. */
  durationSec?: number;
  units: UnitPrefs;
  simulating?: boolean;
  historic?: boolean;
  /** Selected forecast / history / session / radar timestamp (ISO). */
  selectedTime?: string | null;
  /** Radar scrubber is on the latest observed frame. */
  radarFollowLive?: boolean;
  clockMode?: WindMode;
  radarOn?: boolean;
  radarWindows?: RadarWindows | null;
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
  windSlice?: WindFieldSlice | null;
  windFieldStatus?: "idle" | "loading" | "ready" | "error";
  tempSlice?: TempFieldSlice | null;
  tempFieldStatus?: "idle" | "loading" | "ready" | "error";
  overlay: OverlayId;
  basemap: BasemapId;
  windGlyph: WindGlyphId;
  stationsOn?: boolean;
  stations?: StationsResponse | null;
};

type HoverInfo = {
  lon: number;
  lat: number;
  x: number;
  y: number;
  onWater: boolean;
  hsM: number | null;
  depthM: number;
  fetchM: number | null;
  windSpeedMps: number | null;
  windDirDeg: number | null;
  gustMps: number | null;
  tempC: number | null;
};

const BASEMAP_KEY = "chop.basemap";
const OVERLAY_KEY = "chop.mapOverlay";
const WIND_GLYPH_KEY = "chop.windGlyph";
const HEATMAP_STYLE_KEY = "chop.heatmapStyle";

export function loadBasemap(): BasemapId {
  try {
    const v = localStorage.getItem(BASEMAP_KEY);
    if (v === "map" || v === "satellite") return v;
    return "topo";
  } catch {
    return "topo";
  }
}

export function saveBasemap(id: BasemapId): void {
  try {
    localStorage.setItem(BASEMAP_KEY, id);
  } catch {
    // ignore quota / private mode
  }
}

export function loadOverlay(): OverlayId {
  try {
    const v = localStorage.getItem(OVERLAY_KEY);
    if (v === "waves" || v === "depth" || v === "temp") return v;
    return "wind";
  } catch {
    return "wind";
  }
}

export function saveOverlay(id: OverlayId): void {
  try {
    localStorage.setItem(OVERLAY_KEY, id);
  } catch {
    // ignore quota / private mode
  }
}

export function loadWindGlyph(): WindGlyphId {
  try {
    if (localStorage.getItem(WIND_GLYPH_KEY) === "arrows") return "arrows";
    if (localStorage.getItem(WIND_GLYPH_KEY) === "particles") return "particles";
    return prefersReducedWindMotion() ? "arrows" : "particles";
  } catch {
    return "particles";
  }
}

export function saveWindGlyph(id: WindGlyphId): void {
  try {
    localStorage.setItem(WIND_GLYPH_KEY, id);
  } catch {
    // ignore quota / private mode
  }
}

function loadHeatmapStyle(): HeatmapStyle {
  try {
    return localStorage.getItem(HEATMAP_STYLE_KEY) === "edges" ? "edges" : "blend";
  } catch {
    return "blend";
  }
}

function saveHeatmapStyle(id: HeatmapStyle): void {
  try {
    localStorage.setItem(HEATMAP_STYLE_KEY, id);
  } catch {
    // ignore quota / private mode
  }
}

function lakeLineWidth(selectedId: string | null) {
  const selected: ["==", ["get", "lakeId"], string] = [
    "==",
    ["get", "lakeId"],
    selectedId ?? "",
  ];
  // One zoom interpolate only — MapLibre rejects case(interpolate, interpolate).
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    4,
    ["case", selected, 2.4, 1.7],
    11,
    ["case", selected, 3.2, 2.2],
  ] as const;
}

function lakeLineCaseWidth(selectedId: string | null) {
  const selected: ["==", ["get", "lakeId"], string] = [
    "==",
    ["get", "lakeId"],
    selectedId ?? "",
  ];
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    4,
    ["case", selected, 4.2, 3.2],
    11,
    ["case", selected, 5.4, 3.8],
  ] as const;
}

function applyLakeHighlight(
  map: MapLibreMap,
  selectedId: string | null,
  satellite: boolean,
) {
  selectedId = selectedId ?? "";
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
  if (map.getLayer("lakes-all-line-case")) {
    map.setPaintProperty(
      "lakes-all-line-case",
      "line-width",
      lakeLineCaseWidth(selectedId),
    );
  }
}

/** Heatmaps sit above lake fills but under outlines and names. */
function placeHeatmapUnderLakes(map: MapLibreMap, layerId: string) {
  if (!map.getLayer(layerId)) return;
  const before = map.getLayer("lakes-all-line-case")
    ? "lakes-all-line-case"
    : map.getLayer("lakes-all-line")
      ? "lakes-all-line"
      : map.getLayer("lakes-labels")
        ? "lakes-labels"
        : undefined;
  if (before) map.moveLayer(layerId, before);
}

const RADAR_OPACITY = 0.82;
const radarTilesApplied = new Map<string, string>();
type RadarBuf = 0 | 1;
let radarFront: RadarBuf = 0;
let radarAppliedKey = "";
let radarLoadGen = 0;
let radarSourceDataHandler: ((ev: { sourceId?: string }) => void) | null =
  null;

function radarFrameKey(frame: RadarFrame, visible: boolean): string {
  const layers = frame.layers.map((l) => l.wmsLayer).join(",");
  return `${visible ? "1" : "0"}:${frame.kind}:${frame.timeIso ?? ""}:${layers}`;
}

function bufferedRadarId(sourceId: string, buf: RadarBuf): string {
  return buf === 0 ? sourceId : `${sourceId}-b`;
}

function allRadarLayerIds(): string[] {
  return RADAR_OBS_LAYERS.flatMap(({ sourceId }) => [
    bufferedRadarId(sourceId, 0),
    bufferedRadarId(sourceId, 1),
  ]);
}

function setRadarVisibility(
  map: MapLibreMap,
  sourceId: string,
  visible: boolean,
): void {
  if (!map.getLayer(sourceId)) return;
  const next = visible ? "visible" : "none";
  if (map.getLayoutProperty(sourceId, "visibility") === next) return;
  map.setLayoutProperty(sourceId, "visibility", next);
}

function setRadarOpacity(map: MapLibreMap, sourceId: string, opacity: number): void {
  if (!map.getLayer(sourceId)) return;
  if (map.getPaintProperty(sourceId, "raster-opacity") === opacity) return;
  map.setPaintProperty(sourceId, "raster-opacity", opacity);
}

function detachRadarLoadHandler(map: MapLibreMap): void {
  if (!radarSourceDataHandler) return;
  map.off("sourcedata", radarSourceDataHandler);
  radarSourceDataHandler = null;
}

function setRasterTiles(map: MapLibreMap, sourceId: string, tiles: string[]): boolean {
  const next = tiles[0] ?? "";
  if (radarTilesApplied.get(sourceId) === next && map.getSource(sourceId)) {
    return false;
  }
  const src = map.getSource(sourceId) as
    | { setTiles?: (next: string[]) => void }
    | undefined;
  src?.setTiles?.(tiles);
  radarTilesApplied.set(sourceId, next);
  return true;
}

function ensureRadarBuffer(
  map: MapLibreMap,
  buf: RadarBuf,
  frame: RadarFrame,
  shown: boolean,
): boolean {
  let changed = false;
  const opacity = shown ? RADAR_OPACITY : 0;
  for (const { sourceId, wmsLayer } of frame.layers) {
    const id = bufferedRadarId(sourceId, buf);
    const tiles = [radarTileUrl(wmsLayer, frame.timeIso)];
    if (!map.getSource(id)) {
      map.addSource(id, {
        type: "raster",
        tiles,
        tileSize: 256,
        ...(sourceId === RADAR_RAIN_SOURCE && buf === 0
          ? { attribution: RADAR_ATTRIBUTION }
          : {}),
      });
      map.addLayer({
        id,
        type: "raster",
        source: id,
        layout: { visibility: "visible" },
        paint: {
          "raster-opacity": opacity,
          "raster-fade-duration": 0,
        },
      });
      placeHeatmapUnderLakes(map, id);
      radarTilesApplied.set(id, tiles[0] ?? "");
      changed = true;
      continue;
    }
    if (setRasterTiles(map, id, tiles)) changed = true;
    setRadarVisibility(map, id, true);
    setRadarOpacity(map, id, opacity);
  }
  return changed;
}

function radarBufferReady(
  map: MapLibreMap,
  frame: RadarFrame,
  buf: RadarBuf,
): boolean {
  return frame.layers.every(({ sourceId }) => {
    const id = bufferedRadarId(sourceId, buf);
    return !!map.getSource(id) && map.isSourceLoaded(id);
  });
}

function showRadarBuffer(map: MapLibreMap, frame: RadarFrame, buf: RadarBuf): void {
  const hide: RadarBuf = buf === 0 ? 1 : 0;
  for (const { sourceId } of frame.layers) {
    const showId = bufferedRadarId(sourceId, buf);
    const hideId = bufferedRadarId(sourceId, hide);
    setRadarVisibility(map, showId, true);
    setRadarOpacity(map, showId, RADAR_OPACITY);
    setRadarOpacity(map, hideId, 0);
  }
}

function swapRadarBufferWhenReady(
  map: MapLibreMap,
  frame: RadarFrame,
  back: RadarBuf,
  key: string,
): void {
  radarLoadGen += 1;
  const gen = radarLoadGen;
  detachRadarLoadHandler(map);
  const reveal = () => {
    if (gen !== radarLoadGen) return false;
    if (!radarBufferReady(map, frame, back)) return false;
    showRadarBuffer(map, frame, back);
    radarFront = back;
    radarAppliedKey = key;
    detachRadarLoadHandler(map);
    map.triggerRepaint();
    return true;
  };
  if (reveal()) return;
  radarSourceDataHandler = () => {
    reveal();
  };
  map.on("sourcedata", radarSourceDataHandler);
  map.once("idle", reveal);
}

/** Live ECCC radar above heatmaps, under lake outlines. Independent of overlay. */
function ensureRadarLayers(map: MapLibreMap, frame: RadarFrame): void {
  const visible = frame.kind !== "none" && !!frame.timeIso;
  const key = radarFrameKey(frame, visible);
  const frontRain = bufferedRadarId(RADAR_RAIN_SOURCE, radarFront);
  if (
    key === radarAppliedKey &&
    map.getSource(frontRain) &&
    map.getLayer(frontRain)
  ) {
    return;
  }
  if (!visible) {
    detachRadarLoadHandler(map);
    hideRadarLayers(map);
    radarAppliedKey = key;
    return;
  }
  const frontExists = !!map.getSource(bufferedRadarId(RADAR_RAIN_SOURCE, 0));
  if (!frontExists) {
    ensureRadarBuffer(map, 0, frame, true);
    radarFront = 0;
    radarAppliedKey = key;
    map.triggerRepaint();
    return;
  }
  const back: RadarBuf = radarFront === 0 ? 1 : 0;
  ensureRadarBuffer(map, back, frame, false);
  swapRadarBufferWhenReady(map, frame, back, key);
}

function hideRadarLayers(map: MapLibreMap): void {
  for (const id of allRadarLayerIds()) {
    setRadarOpacity(map, id, 0);
    setRadarVisibility(map, id, false);
  }
}

function removeRadarLayers(map: MapLibreMap): void {
  detachRadarLoadHandler(map);
  for (const id of [...allRadarLayerIds()].reverse()) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
    radarTilesApplied.delete(id);
  }
  radarFront = 0;
  radarAppliedKey = "";
  radarLoadGen += 1;
}

/** MapLibre canvas sources skip prepare() until a covering tile exists; poke after paint. */
function publishWindFieldSource(map: MapLibreMap): void {
  const src = map.getSource("wind-field") as CanvasSource | undefined;
  if (!src) return;
  src.play?.();
  src.setCoordinates(windCanvasCoordinates());
  map.triggerRepaint();
}

const BASEMAP_LAYER_IDS = [
  "basemap-satellite",
  "basemap-map",
  "basemap-topo-hillshade",
] as const;

function ensureBasemapLayers(map: MapLibreMap): void {
  const beforeId = map.getLayer("alberta-mask") ? "alberta-mask" : undefined;
  if (!map.getSource("topo-hillshade")) {
    map.addSource("topo-hillshade", {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 16,
      attribution:
        "Tiles &copy; Esri — Source: Esri, USGS, NOAA, and the GIS User Community",
    });
  }
  if (!map.getLayer("basemap-topo-hillshade")) {
    map.addLayer(
      {
        id: "basemap-topo-hillshade",
        type: "raster",
        source: "topo-hillshade",
        layout: { visibility: "none" },
        paint: { "raster-opacity": 1 },
        minzoom: 0,
        maxzoom: 22,
      },
      beforeId,
    );
  }
  if (map.getLayer("basemap-topo")) {
    map.setLayoutProperty("basemap-topo", "visibility", "none");
  }
}

function applyBasemap(
  map: MapLibreMap,
  id: BasemapId,
  selectedLakeId: string | null,
): void {
  ensureBasemapLayers(map);
  const vis = (layer: (typeof BASEMAP_LAYER_IDS)[number], on: boolean) => {
    if (map.getLayer(layer)) {
      map.setLayoutProperty(layer, "visibility", on ? "visible" : "none");
    }
  };
  vis("basemap-map", id === "map");
  vis("basemap-satellite", id === "satellite");
  vis("basemap-topo-hillshade", id === "topo");
  if (map.getLayer("basemap-topo")) {
    map.setLayoutProperty("basemap-topo", "visibility", "none");
  }
  if (map.getLayer("lakes-all-line-case")) {
    map.setPaintProperty(
      "lakes-all-line-case",
      "line-color",
      id === "satellite" ? "rgba(20, 28, 26, 0.75)" : "rgba(248, 246, 240, 0.92)",
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

/** Raster basemaps — Carto light, Esri World Imagery, Esri hillshade. Overlay layers are added after load. */
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
      "topo-hillshade": {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 16,
        attribution:
          "Tiles &copy; Esri — Source: Esri, USGS, NOAA, and the GIS User Community",
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#d7cbb0" },
      },
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
      {
        id: "basemap-topo-hillshade",
        type: "raster",
        source: "topo-hillshade",
        layout: { visibility: basemap === "topo" ? "visible" : "none" },
        paint: { "raster-opacity": 1 },
        minzoom: 0,
        maxzoom: 22,
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

/** One label point per lake (polygon labels drop easily under heatmaps / zoom). */
function lakeLabelGeoJSON(
  fc: GeoJSON.FeatureCollection,
): GeoJSON.FeatureCollection {
  const names = new Map<string, string>();
  for (const f of fc.features) {
    const id = f.properties?.lakeId;
    const name = f.properties?.name;
    if (typeof id === "string" && typeof name === "string" && !names.has(id)) {
      names.set(id, name);
    }
  }
  const features: GeoJSON.Feature[] = [];
  for (const [id, b] of boundsByLakeId(fc)) {
    const name = names.get(id);
    if (!name) continue;
    features.push({
      type: "Feature",
      properties: { lakeId: id, name },
      geometry: {
        type: "Point",
        coordinates: [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/** LineString rings only — polygon fill+line on the same heavy source stalls the worker. */
function lakeOutlineGeoJSON(
  fc: GeoJSON.FeatureCollection,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const f of fc.features) {
    const rings = polygonRings(f.geometry);
    if (rings.length === 0) continue;
    features.push({
      type: "Feature",
      properties: {
        lakeId: f.properties?.lakeId,
        name: f.properties?.name,
      },
      geometry:
        rings.length === 1
          ? { type: "LineString", coordinates: rings[0]! }
          : { type: "MultiLineString", coordinates: rings },
    });
  }
  return { type: "FeatureCollection", features };
}

const ALBERTA_MASK = albertaMask as GeoJSON.FeatureCollection;

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

const WX_STATION_SOURCE = "wx-stations";
const WX_STATION_LAYERS = [
  "wx-stations-halo",
  "wx-stations-dot",
  "wx-stations-arrow",
  "wx-stations-label",
] as const;
const WX_STATION_HIT_LAYERS = ["wx-stations-halo", "wx-stations-dot"] as const;

type StationHover = {
  feature: StationFeature;
  x: number;
  y: number;
};

function stationFromMapFeature(
  raw: { properties?: GeoJSON.GeoJsonProperties | null } | undefined,
): StationFeature["properties"] | null {
  const p = raw?.properties;
  if (!p || typeof p.name !== "string") return null;
  return p as unknown as StationFeature["properties"];
}

function spatialWindSlice(
  slice: WindFieldSlice | null | undefined,
  allowUniform: boolean,
): WindFieldSlice | null {
  if (!slice) return null;
  if (slice.uniform && !allowUniform) return null;
  return slice;
}

function albertaViewCenter(): [number, number] {
  const { west, south, east, north } = windFieldExtent();
  return [(west + east) / 2, (south + north) / 2];
}

function hoverFromMapEvent(
  e: MapMouseEvent,
  grids: LakeGrids | null,
  overlay: OverlayId,
  simulating: boolean,
  windSlice: WindFieldSlice | null | undefined,
  heatmapStyle: HeatmapStyle,
  tempSlice: TempFieldSlice | null,
  hs: Float32Array | null,
  wind: WindHour | null,
): HoverInfo | null {
  const { lng, lat } = e.lngLat;
  const depthM = grids ? sampleGrid(grids.depth, grids.meta, lng, lat) : null;
  const onWater = depthM != null && depthM > 0;
  const slice = spatialWindSlice(windSlice, simulating);
  const field = slice
    ? sampleWindField(slice, lng, lat, heatmapStyle)
    : null;
  const windMode = overlay === "wind";
  const tempMode = overlay === "temp";
  const airC = tempSlice
    ? sampleTempField(tempSlice, lng, lat, heatmapStyle)
    : null;
  if (windMode) {
    const overField = slice ? inWindFieldExtent(slice, lng, lat) : false;
    if (!overField && !onWater && !field) return null;
  } else if (tempMode) {
    const overField = tempSlice
      ? lng >= tempSlice.west &&
        lng <= tempSlice.east &&
        lat >= tempSlice.south &&
        lat <= tempSlice.north
      : false;
    if (!overField && !onWater && airC == null) return null;
  } else if (!onWater) {
    return null;
  }
  let fetchM: number | null = null;
  const hsM =
    onWater && hs && grids ? sampleGrid(hs, grids.meta, lng, lat) : null;
  if (onWater && wind && grids) {
    const { ncols, nrows, west, south, east, north } = grids.meta;
    const fx = ((lng - west) / (east - west)) * ncols;
    const fy = ((north - lat) / (north - south)) * nrows;
    const i = Math.min(ncols - 1, Math.max(0, Math.floor(fx)));
    const j = Math.min(nrows - 1, Math.max(0, Math.floor(fy)));
    const idx = j * ncols + i;
    if (grids.depth[idx]! > 0) {
      fetchM = fetchAtDir(grids.fetch, grids.meta, idx, wind.windDirDeg);
    }
  }
  return {
    lon: lng,
    lat,
    x: e.point.x,
    y: e.point.y,
    onWater,
    hsM,
    depthM: onWater ? depthM! : 0,
    fetchM,
    windSpeedMps: field?.speedMps ?? (windMode ? null : wind?.windSpeedMps ?? null),
    windDirDeg: field?.dirDeg ?? (windMode ? null : wind?.windDirDeg ?? null),
    gustMps: field || windMode ? null : wind?.gustMps ?? null,
    tempC: airC,
  };
}

function ensureWindArrowsSource(map: MapLibreMap) {
  if (!map.getSource("wind-arrows")) {
    map.addSource("wind-arrows", { type: "geojson", data: EMPTY_FC });
  }
}

function ensureWindArrowsLineLayer(map: MapLibreMap, visible: boolean) {
  ensureWindArrowsSource(map);
  const vis = visible ? "visible" : "none";
  if (map.getLayer("wind-arrows-case")) {
    map.removeLayer("wind-arrows-case");
  }
  const leftover = map.getLayer("wind-arrows");
  if (leftover && leftover.type !== "line") {
    map.removeLayer("wind-arrows");
  }
  if (!map.getLayer("wind-arrows")) {
    map.addLayer({
      id: "wind-arrows",
      type: "line",
      source: "wind-arrows",
      layout: {
        visibility: vis,
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": WIND_STREAK_COLOR,
        "line-width": 1.7,
        "line-opacity": 1,
      },
    });
  } else {
    map.setLayoutProperty("wind-arrows", "visibility", vis);
    map.setPaintProperty("wind-arrows", "line-color", WIND_STREAK_COLOR);
  }
}

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
  durationSec,
  units,
  simulating = false,
  historic = false,
  selectedTime = null,
  radarFollowLive = false,
  clockMode = "forecast",
  radarOn = false,
  radarWindows = null,
  forecastPoint = null,
  gpxTrack = null,
  gpxCursor = null,
  gpxWindTicks = null,
  gpxWindTickIndex = null,
  followCursor = false,
  onFollowCursorChange,
  onChoosePoint,
  onClearPoint,
  windSlice = null,
  windFieldStatus = "idle",
  tempSlice = null,
  tempFieldStatus = "idle",
  overlay,
  basemap,
  windGlyph,
  stationsOn = false,
  stations = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const hsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const windCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const windParticleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const windGlyphLiftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lakeOutlineCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const windParticlesRef = useRef(createParticleField());
  const arrowLayoutRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const albertaWindMaskRef = useRef<HTMLCanvasElement | null>(null);
  const shoreMaskRef = useRef<HTMLCanvasElement | null>(null);
  const hsRef = useRef<Float32Array | null>(null);
  const windRef = useRef<WindHour | null>(null);
  const gridsRef = useRef(grids);
  const shorelineRef = useRef(shoreline);
  const allShorelinesRef = useRef(allShorelines);
  const selectedLakeIdRef = useRef(selectedLakeId);
  const onSelectLakeRef = useRef(onSelectLake);
  const viewModeRef = useRef<"all" | "lake">("all");
  const lakesVectorReadyRef = useRef(false);
  const fittedLakeIdRef = useRef<string | null>(null);
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
  const forecastPointRef = useRef(forecastPoint);
  forecastPointRef.current = forecastPoint;
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [stationHover, setStationHover] = useState<StationHover | null>(null);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(
    null,
  );
  const [ready, setReady] = useState(false);
  const [legendHoverT, setLegendHoverT] = useState<number | null>(null);
  const [radarLegendHoverT, setRadarLegendHoverT] = useState<number | null>(
    null,
  );
  const [legendTipOpen, setLegendTipOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const layersRef = useRef<HTMLDivElement>(null);
  const [heatmapStyle, setHeatmapStyle] = useState<HeatmapStyle>(() =>
    typeof window !== "undefined" ? loadHeatmapStyle() : "blend",
  );
  const [radarFrame, setRadarFrame] = useState<RadarFrame>(() =>
    resolveRadarFrame(null, null),
  );
  const [fieldHeatmapReady, setFieldHeatmapReady] = useState(false);
  const overlayRef = useRef(overlay);
  const basemapRef = useRef(basemap);
  const radarOnRef = useRef(radarOn);
  const stationsOnRef = useRef(stationsOn);
  const selectedStationIdRef = useRef<string | null>(null);
  const windGlyphRef = useRef(windGlyph);
  const heatmapStyleRef = useRef(heatmapStyle);
  const windSliceRef = useRef(windSlice);
  const tempSliceRef = useRef(tempSlice);
  const simulatingRef = useRef(simulating);
  overlayRef.current = overlay;
  basemapRef.current = basemap;
  radarOnRef.current = radarOn;
  stationsOnRef.current = stationsOn;
  selectedStationIdRef.current = selectedStationId;
  windGlyphRef.current = windGlyph;
  heatmapStyleRef.current = heatmapStyle;
  windSliceRef.current = windSlice;
  tempSliceRef.current = tempSlice;
  simulatingRef.current = simulating;

  useEffect(() => {
    setLegendHoverT(null);
    setLegendTipOpen(false);
  }, [overlay, radarOn]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!radarOn) {
      removeRadarLayers(map);
      setRadarFrame(resolveRadarFrame(null, null));
      return;
    }
    if (clockMode === "sim") {
      hideRadarLayers(map);
      setRadarFrame(resolveRadarFrame(null, null));
      return;
    }
    const selectedMs = (() => {
      if (!selectedTime) return null;
      const t = Date.parse(selectedTime);
      return Number.isFinite(t) ? t : null;
    })();
    const frame = resolveRadarFrame(selectedMs, radarWindows, radarFollowLive);
    ensureRadarLayers(map, frame);
    setRadarFrame(frame);
  }, [radarOn, ready, selectedTime, radarFollowLive, clockMode, radarWindows]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource(WX_STATION_SOURCE) as GeoJSONSource | undefined;
    src?.setData(stationsOn && stations?.features.length ? stations : EMPTY_FC);
    const vis = stationsOn ? "visible" : "none";
    for (const id of WX_STATION_LAYERS) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", vis);
      }
    }
    if (!stationsOn) {
      selectedStationIdRef.current = null;
      setSelectedStationId(null);
      setStationHover(null);
    }
  }, [ready, stationsOn, stations]);

  gridsRef.current = grids;
  shorelineRef.current = shoreline;

  const hs = useMemo(() => {
    if (!grids || radarOn || !wind || overlay !== "waves") return null;
    if (windSlice && !windSlice.uniform) {
      return computeHsGridFromWind(grids, windSlice, durationSec);
    }
    return computeHsGrid(grids, wind.windSpeedMps, wind.windDirDeg, durationSec);
  }, [grids, wind, overlay, windSlice, durationSec, radarOn]);

  hsRef.current = hs;
  windRef.current = wind;

  const vmax = HS_COLOR_MAX_M;
  const depthMaxM = useMemo(
    () => (grids ? depthMaxFromGrid(grids.depth, grids.meta.nodata) : 0),
    [grids],
  );
  const depthIntervalM = grids?.meta.contourIntervalM ?? 1;
  const { min: legendMin, max: legendMax } = legendRange(
    overlay,
    depthMaxM,
    vmax,
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const meta = grids?.meta;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: makeStyle(basemap),
      center: spot
        ? [spot.identity.longitude, spot.identity.latitude]
        : albertaViewCenter(),
      zoom: spot ? 11.2 : 5.6,
      bearing: 0,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(
      new NavigationControl({ visualizePitch: false, showCompass: false }),
      "top-right",
    );
    mapRef.current = map;

    // style.load fires when the style JSON is ready. map "load" waits for every
    // raster source, including hidden Satellite/Topo tiles, so overlays never boot.
    const bootOverlays = () => {
      if (map.getLayer("lakes-labels")) {
        setReady(true);
        return;
      }
      try {
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

      map.addSource("shoreline", { type: "geojson", data: shoreline ?? EMPTY_FC });
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
        data: EMPTY_FC,
        tolerance: 1.2,
        buffer: 32,
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
      map.addSource("lakes-all-outlines", {
        type: "geojson",
        data: EMPTY_FC,
        tolerance: 0.4,
        buffer: 32,
      });
      map.addLayer({
        id: "lakes-all-line-case",
        type: "line",
        source: "lakes-all-outlines",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "rgba(248, 246, 240, 0.92)",
          "line-width": lakeLineCaseWidth(selectedLakeIdRef.current),
          "line-opacity": 1,
        },
      });
      map.addLayer({
        id: "lakes-all-line",
        type: "line",
        source: "lakes-all-outlines",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#163a44",
          "line-width": lakeLineWidth(selectedLakeIdRef.current),
          "line-opacity": 1,
        },
      });
      map.addSource("lakes-label-points", {
        type: "geojson",
        data: EMPTY_FC,
      });
      map.addLayer({
        id: "lakes-labels",
        type: "symbol",
        source: "lakes-label-points",
        layout: {
          visibility: "none",
          "text-field": ["get", "name"],
          "text-size": 12,
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
          "text-anchor": "center",
        },
        paint: {
          "text-color": "#163a44",
          "text-halo-color": "rgba(248, 246, 240, 0.95)",
          "text-halo-width": 1.8,
        },
      });

      const canvas = document.createElement("canvas");
      if (meta && shoreline) {
        const size = hsCanvasSize(meta);
        canvas.width = size.width;
        canvas.height = size.height;
        shoreMaskRef.current = buildShoreMaskCanvas(meta, shoreline);
      } else {
        canvas.width = 1;
        canvas.height = 1;
      }
      hsCanvasRef.current = canvas;
      map.addSource("hs", {
        type: "canvas",
        canvas,
        coordinates: meta ? hsCoordinates(meta) : windCanvasCoordinates(),
        animate: true,
      });
      map.addLayer({
        id: "hs-layer",
        type: "raster",
        source: "hs",
        layout: { visibility: showsFieldHeatmap(overlay, radarOn) ? "none" : "visible" },
        paint: {
          "raster-opacity": 0.92,
          "raster-resampling": heatmapStyle === "edges" ? "nearest" : "linear",
          "raster-fade-duration": 0,
        },
      });

      const windCanvas = document.createElement("canvas");
      const windSize = windCanvasSize();
      windCanvas.width = windSize.width;
      windCanvas.height = windSize.height;
      windCanvasRef.current = windCanvas;
      albertaWindMaskRef.current = buildAlbertaWindMask();
      map.addSource("wind-field", {
        type: "canvas",
        canvas: windCanvas,
        coordinates: windCanvasCoordinates(),
        animate: true,
      });
      map.addLayer({
        id: "wind-field",
        type: "raster",
        source: "wind-field",
        layout: { visibility: showsFieldHeatmap(overlay, radarOn) ? "visible" : "none" },
        paint: {
          "raster-opacity": 1,
          "raster-resampling": heatmapStyle === "edges" ? "nearest" : "linear",
          "raster-fade-duration": 0,
        },
      });
      placeHeatmapUnderLakes(map, "hs-layer");
      placeHeatmapUnderLakes(map, "wind-field");

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
        layout: { visibility: "none" },
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
        layout: { visibility: "none" },
        paint: {
          "circle-radius": 4,
          "circle-color": "#0f6b5c",
        },
      });

      map.addSource(WX_STATION_SOURCE, { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "wx-stations-halo",
        type: "circle",
        source: WX_STATION_SOURCE,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            5,
            8,
            7,
            12,
            9,
          ],
          "circle-color": "#f8f6f0",
          "circle-opacity": 0.92,
          "circle-stroke-color": "#1c201e",
          "circle-stroke-width": 1.25,
        },
      });
      map.addLayer({
        id: "wx-stations-dot",
        type: "circle",
        source: WX_STATION_SOURCE,
        layout: { visibility: "none" },
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            2.2,
            8,
            3.2,
            12,
            4,
          ],
          "circle-color": [
            "case",
            [">", ["get", "hasObs"], 0],
            "#2c5a82",
            "#8a8680",
          ],
        },
      });
      if (!map.hasImage("wind-arrow")) {
        map.addImage("wind-arrow", makeArrowIcon(128), { sdf: true });
      }
      map.addLayer({
        id: "wx-stations-arrow",
        type: "symbol",
        source: WX_STATION_SOURCE,
        filter: [">", ["get", "hasWind"], 0],
        layout: {
          visibility: "none",
          "icon-image": "wind-arrow",
          "icon-size": 0.18,
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          "icon-offset": [0, -18],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-color": "#2c5a82",
          "icon-halo-color": "rgba(248, 246, 240, 0.95)",
          "icon-halo-width": 1.4,
        },
      });
      map.addLayer({
        id: "wx-stations-label",
        type: "symbol",
        source: WX_STATION_SOURCE,
        minzoom: 7.2,
        layout: {
          visibility: "none",
          "text-field": ["get", "name"],
          "text-size": 11,
          "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
          "text-offset": [0, 1.15],
          "text-anchor": "top",
          "text-optional": true,
          "text-padding": 4,
        },
        paint: {
          "text-color": "#1c201e",
          "text-halo-color": "rgba(248, 246, 240, 0.92)",
          "text-halo-width": 1.3,
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

      map.addSource("wind-arrows", { type: "geojson", data: EMPTY_FC });

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

      applyBasemap(map, basemapRef.current, selectedLakeIdRef.current);
      const overview = allShorelinesRef.current;
      const selected = selectedLakeIdRef.current;
      const selectedBounds = selected
        ? boundsByLakeRef.current.get(selected)
        : undefined;
      if (selected && selectedBounds) {
        viewModeRef.current = "lake";
        fittedLakeIdRef.current = selected;
        fitBoundsPad(map, selectedBounds, 0);
      } else if (overview && overview.features.length > 0) {
        viewModeRef.current = "all";
        fitFeatureCollection(map, overview, 0);
      } else if (meta && shoreline) {
        fitLake(map, meta, shoreline, 0);
        viewModeRef.current = "lake";
        fittedLakeIdRef.current = selected;
      } else {
        viewModeRef.current = "all";
      }
      setReady(true);
      } catch (err) {
        console.error("Map overlays failed", err);
        setReady(true);
      }
    };
    if (map.isStyleLoaded()) bootOverlays();
    else map.once("style.load", bootOverlays);

    map.on("movestart", (e) => {
      if (!e.originalEvent) return;
      userMovedRef.current = true;
      if (followCursorRef.current) onFollowCursorChangeRef.current?.(false);
    });

    const coarseRef = {
      current:
        typeof window !== "undefined" &&
        window.matchMedia("(pointer: coarse)").matches,
    };
    const onTouchStart = () => {
      coarseRef.current = true;
    };
    window.addEventListener("touchstart", onTouchStart, {
      passive: true,
      once: true,
    });
    let tapHoverTimer: number | undefined;
    const showTapHover = (info: HoverInfo | null) => {
      setHover(info);
      window.clearTimeout(tapHoverTimer);
      if (info) {
        tapHoverTimer = window.setTimeout(() => setHover(null), 8000);
      }
    };

    map.on("mousemove", (e: MapMouseEvent) => {
      if (coarseRef.current) return;
      if (stationsOnRef.current) {
        const layers = WX_STATION_HIT_LAYERS.filter((id) => map.getLayer(id));
        if (layers.length > 0) {
          const hits = map.queryRenderedFeatures(e.point, { layers });
          const props = stationFromMapFeature(hits[0]);
          if (props) {
            const geom = hits[0]?.geometry;
            const coords =
              geom?.type === "Point" ? geom.coordinates : null;
            const lon = typeof coords?.[0] === "number" ? coords[0] : e.lngLat.lng;
            const lat = typeof coords?.[1] === "number" ? coords[1] : e.lngLat.lat;
            setStationHover({
              feature: {
                type: "Feature",
                id: props.id,
                geometry: { type: "Point", coordinates: [lon, lat] },
                properties: props,
              },
              x: e.point.x,
              y: e.point.y,
            });
            setHover(null);
            map.getCanvas().style.cursor = "pointer";
            return;
          }
        }
        if (!selectedStationIdRef.current) setStationHover(null);
      }
      map.getCanvas().style.cursor = "";
      setHover(
        hoverFromMapEvent(
          e,
          gridsRef.current,
          radarOnRef.current ? "wind" : overlayRef.current,
          simulatingRef.current,
          windSliceRef.current,
          heatmapStyleRef.current,
          tempSliceRef.current ?? null,
          hsRef.current,
          windRef.current,
        ),
      );
    });

    map.on("click", (e: MapMouseEvent) => {
      if (stationsOnRef.current) {
        const stLayers = WX_STATION_HIT_LAYERS.filter((id) => map.getLayer(id));
        if (stLayers.length > 0) {
          const stHits = map.queryRenderedFeatures(e.point, {
            layers: stLayers,
          });
          const props = stationFromMapFeature(stHits[0]);
          if (props) {
            const geom = stHits[0]?.geometry;
            const coords =
              geom?.type === "Point" ? geom.coordinates : null;
            const lon =
              typeof coords?.[0] === "number" ? coords[0] : e.lngLat.lng;
            const lat =
              typeof coords?.[1] === "number" ? coords[1] : e.lngLat.lat;
            selectedStationIdRef.current = props.id;
            setSelectedStationId(props.id);
            setStationHover({
              feature: {
                type: "Feature",
                id: props.id,
                geometry: { type: "Point", coordinates: [lon, lat] },
                properties: props,
              },
              x: e.point.x,
              y: e.point.y,
            });
            if (coarseRef.current) showTapHover(null);
            return;
          }
        }
        selectedStationIdRef.current = null;
        setSelectedStationId(null);
        setStationHover(null);
      }
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
        if (coarseRef.current) showTapHover(null);
        return;
      }
      const { lng, lat } = e.lngLat;
      const g = gridsRef.current;
      if (!g) {
        if (coarseRef.current) showTapHover(null);
        return;
      }
      const depthM = sampleGrid(g.depth, g.meta, lng, lat);
      const info = hoverFromMapEvent(
        e,
        g,
        radarOnRef.current ? "wind" : overlayRef.current,
        simulatingRef.current,
        windSliceRef.current,
        heatmapStyleRef.current,
        tempSliceRef.current ?? null,
        hsRef.current,
        windRef.current,
      );
      if (depthM != null && depthM > 0) {
        onChoosePointRef.current?.({ lon: lng, lat });
      }
      if (coarseRef.current) {
        if (info) {
          showTapHover(info);
        } else if (depthM != null && depthM > 0) {
          showTapHover({
            lon: lng,
            lat,
            x: e.point.x,
            y: e.point.y,
            onWater: true,
            hsM: null,
            depthM,
            fetchM: null,
            windSpeedMps: null,
            windDirDeg: null,
            gustMps: null,
            tempC: null,
          });
        } else {
          showTapHover(null);
        }
      }
    });

    map.on("mouseenter", "lakes-all-fill", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "lakes-all-fill", () => {
      map.getCanvas().style.cursor = "";
    });

    map.on("mouseout", () => {
      if (coarseRef.current) return;
      setHover(null);
      if (!selectedStationIdRef.current) setStationHover(null);
    });

    let lastW = 0;
    let lastH = 0;
    const refitIfNeeded = () => {
      const el = containerRef.current;
      if (!el) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === lastW && h === lastH) return;
      const dh = Math.abs(h - lastH);
      const first = lastW === 0;
      lastW = w;
      lastH = h;
      map.resize();
      // Skip camera refit on tiny iOS toolbar/resizes — that loop freezes the map.
      if (first || followCursorRef.current || userMovedRef.current || dh < 24) {
        return;
      }
      if (viewModeRef.current === "all" && allShorelinesRef.current) {
        if (!lakesVectorReadyRef.current) return;
        fitFeatureCollection(map, allShorelinesRef.current, 0);
        return;
      }
      const selected = selectedLakeIdRef.current;
      const bounds = selected
        ? boundsByLakeRef.current.get(selected)
        : undefined;
      if (bounds) {
        fitBoundsPad(map, bounds, 0);
        return;
      }
      const g = gridsRef.current;
      const shore = shorelineRef.current;
      if (g && shore) fitLake(map, g.meta, shore, 0);
    };
    const onResize = () => refitIfNeeded();
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(refitIfNeeded);
    ro.observe(containerRef.current);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("touchstart", onTouchStart);
      window.clearTimeout(tapHoverTimer);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      hsCanvasRef.current = null;
      windCanvasRef.current = null;
      windParticlesRef.current = createParticleField();
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move shoreline, Hs georef, and camera when the active lake changes
  useEffect(() => {
    const map = mapRef.current;
    const canvas = hsCanvasRef.current;
    if (!map || !ready || !canvas) return;

    const showOverlay = !!spot && !!grids && !!shoreline && spot.spotId === selectedLakeId;
    const shoreSrc = map.getSource("shoreline") as GeoJSONSource | undefined;
    if (showOverlay) {
      shoreSrc?.setData(shoreline);

      const { meta } = grids;
      const size = hsCanvasSize(meta);
      if (canvas.width !== size.width || canvas.height !== size.height) {
        canvas.width = size.width;
        canvas.height = size.height;
      }
      const hsSrc = map.getSource("hs") as CanvasSource | undefined;
      hsSrc?.setCoordinates(hsCoordinates(meta));
    } else {
      shoreSrc?.setData(EMPTY_FC);
    }

    applyLakeHighlight(map, selectedLakeId, basemap === "satellite");
  }, [grids, shoreline, selectedLakeId, ready, spot?.spotId, basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!selectedLakeId) {
      if (fittedLakeIdRef.current == null) return;
      fittedLakeIdRef.current = null;
      userMovedRef.current = false;
      viewModeRef.current = "all";
      if (allShorelinesRef.current) {
        fitFeatureCollection(map, allShorelinesRef.current, 800);
      }
      return;
    }
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
    lakesVectorReadyRef.current = false;
    const outlines = map.getSource("lakes-all-outlines") as GeoJSONSource | undefined;
    const labels = map.getSource("lakes-label-points") as GeoJSONSource | undefined;
    const fill = map.getSource("lakes-all") as GeoJSONSource | undefined;
    let poll = 0;
    let sawLoading = false;

    const finish = () => {
      if (lakesVectorReadyRef.current) return;
      lakesVectorReadyRef.current = true;
      window.clearInterval(poll);
      map.off("sourcedata", onSource);
      fill?.setData(cloneFc(allShorelines));
      const selected = selectedLakeIdRef.current;
      const lakeBounds = selected
        ? boundsByLakeRef.current.get(selected)
        : undefined;
      if (
        lakeBounds &&
        fittedLakeIdRef.current !== selected &&
        !userMovedRef.current
      ) {
        fittedLakeIdRef.current = selected;
        viewModeRef.current = "lake";
        fitBoundsPad(map, lakeBounds, 0);
      } else if (!userMovedRef.current && viewModeRef.current === "all") {
        fitFeatureCollection(map, allShorelines, 0);
      }
    };
    const onSource = (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if (e.sourceId !== "lakes-all-outlines") return;
      if (!e.isSourceLoaded) {
        sawLoading = true;
        return;
      }
      if (sawLoading) finish();
    };
    map.on("sourcedata", onSource);
    outlines?.setData(lakeOutlineGeoJSON(allShorelines));
    labels?.setData(lakeLabelGeoJSON(allShorelines));
    poll = window.setInterval(() => {
      if (!map.isSourceLoaded("lakes-all-outlines")) {
        sawLoading = true;
        return;
      }
      if (sawLoading) finish();
    }, 100);
    return () => {
      map.off("sourcedata", onSource);
      window.clearInterval(poll);
    };
  }, [allShorelines, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = lakeOutlineCanvasRef.current;
    if (!map || !ready || !canvas) return;
    const draw = () => {
      drawLakeOutlines(
        canvas,
        map,
        allShorelinesRef.current,
        selectedLakeIdRef.current,
        basemap === "satellite",
        forecastPointRef.current,
      );
    };
    draw();
    map.on("move", draw);
    map.on("resize", draw);
    const ro = new ResizeObserver(draw);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      map.off("move", draw);
      map.off("resize", draw);
      ro.disconnect();
    };
  }, [ready, allShorelines, selectedLakeId, basemap, forecastPoint]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    applyBasemap(map, basemap, selectedLakeId);
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
    const g = gridsRef.current;
    const shore = shorelineRef.current;
    if (!g || !shore) {
      src.setData(EMPTY_FC);
      return;
    }
    src.setData(
      fetchRayGeoJSON(
        g,
        shore,
        hover.lon,
        hover.lat,
        hover.windDirDeg,
      ),
    );
  }, [hover, ready]);

  useEffect(() => {
    const canvas = hsCanvasRef.current;
    const shore = shorelineRef.current;
    if (!ready || !canvas || !grids || !spot || !shore) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const size = hsCanvasSize(grids.meta);
    if (canvas.width !== size.width || canvas.height !== size.height) {
      canvas.width = size.width;
      canvas.height = size.height;
    }
    if (spot.spotId !== selectedLakeId || showsFieldHeatmap(overlay, radarOn)) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    if (radarOn || (overlay !== "waves" && overlay !== "depth")) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    let mask = shoreMaskRef.current;
    if (!mask || mask.width !== size.width || mask.height !== size.height) {
      mask = buildShoreMaskCanvas(grids.meta, shore);
      shoreMaskRef.current = mask;
    }
    if (overlay === "depth") {
      paintHsClipped(
        ctx,
        depthToImageData(grids.depth, grids.meta, depthMaxM, DEFAULT_DEPTH_SCALE),
        mask,
        heatmapStyle === "blend",
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
      heatmapStyle === "blend",
    );
  }, [hs, overlay, ready, grids, vmax, depthMaxM, spot?.spotId, selectedLakeId, heatmapStyle, radarOn]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("depth-contours") as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(
      !radarOn && overlay === "depth" && depthContours ? depthContours : EMPTY_FC,
    );
    const vis =
      !radarOn && overlay === "depth" && spot?.spotId === selectedLakeId
        ? "visible"
        : "none";
    if (map.getLayer("depth-contours")) {
      map.setLayoutProperty("depth-contours", "visibility", vis);
    }
    if (map.getLayer("depth-contour-labels")) {
      map.setLayoutProperty("depth-contour-labels", "visibility", vis);
    }
  }, [overlay, depthContours, ready, spot?.spotId, selectedLakeId, radarOn]);

  useEffect(() => {
    setFieldHeatmapReady(false);
  }, [overlay, radarOn]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const showHeatmap = showsFieldHeatmap(overlay, radarOn);
    const showGlyphs = showsWindGlyphs(overlay, radarOn);
    const showHs = !radarOn && !showHeatmap && spot?.spotId === selectedLakeId;
    if (map.getLayer("hs-layer")) {
      map.setLayoutProperty("hs-layer", "visibility", showHs ? "visible" : "none");
      map.setPaintProperty(
        "hs-layer",
        "raster-resampling",
        heatmapStyle === "edges" ? "nearest" : "linear",
      );
    }
    if (map.getLayer("wind-field")) {
      map.setLayoutProperty("wind-field", "visibility", showHeatmap ? "visible" : "none");
      map.setPaintProperty(
        "wind-field",
        "raster-resampling",
        heatmapStyle === "edges" ? "nearest" : "linear",
      );
    }
    try {
      ensureWindArrowsLineLayer(map, false);
    } catch (err) {
      console.error("Wind arrows layer failed", err);
    }
    if (map.getLayer("hs-layer")) placeHeatmapUnderLakes(map, "hs-layer");
    if (showHeatmap && map.getLayer("wind-field")) {
      placeHeatmapUnderLakes(map, "wind-field");
    }
    if (map.getLayer("lakes-all-line-case")) map.moveLayer("lakes-all-line-case");
    if (map.getLayer("lakes-all-line")) map.moveLayer("lakes-all-line");
    if (map.getLayer("lakes-labels")) map.moveLayer("lakes-labels");
    if (showGlyphs && map.getLayer("wind-arrows")) map.moveLayer("wind-arrows");
  }, [overlay, ready, spot?.spotId, selectedLakeId, windGlyph, heatmapStyle, radarOn]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = windCanvasRef.current;
    if (!map || !ready || !canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    let raf = 0;
    let cancelled = false;
    const markPainted = () => {
      publishWindFieldSource(map);
      raf = window.requestAnimationFrame(() => {
        if (cancelled) return;
        map.triggerRepaint();
        raf = window.requestAnimationFrame(() => {
          if (cancelled) return;
          setFieldHeatmapReady(true);
        });
      });
    };
    const apply = () => {
      const radarNow = radarOnRef.current;
      if (radarNow) {
        setFieldHeatmapReady(true);
        return;
      }
      const slice = spatialWindSlice(
        windSliceRef.current,
        simulatingRef.current,
      );
      const overlayNow = overlayRef.current;
      const showWindHeat = showsWindHeatmap(overlayNow, radarNow);
      const showTempHeat = showsTempHeatmap(overlayNow, radarNow);
      const showGlyphs = showsWindGlyphs(overlayNow, radarNow);
      const tempNow = simulatingRef.current
        ? null
        : (tempSliceRef.current ?? null);
      if (!showWindHeat && !showTempHeat && !showGlyphs) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const src = map.getSource("wind-arrows") as GeoJSONSource | undefined;
        src?.setData(EMPTY_FC);
        setFieldHeatmapReady(true);
        return;
      }
      if (showTempHeat && tempNow) {
        const mask = buildAlbertaWindMask();
        albertaWindMaskRef.current = mask;
        paintTempField(ctx, tempNow, mask, heatmapStyleRef.current);
        markPainted();
      } else if (showWindHeat && slice) {
        const mask = buildAlbertaWindMask();
        albertaWindMaskRef.current = mask;
        paintWindField(ctx, slice, mask, heatmapStyleRef.current);
        markPainted();
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        map.triggerRepaint();
        setFieldHeatmapReady(true);
      }
      applyArrows();
    };
    const applyArrows = () => {
      try {
        ensureWindArrowsLineLayer(map, false);
        const src = map.getSource("wind-arrows") as GeoJSONSource | undefined;
        src?.setData(EMPTY_FC);
      } catch (err) {
        console.error("Wind arrows failed", err);
      }
    };
    apply();
    map.on("zoomend", applyArrows);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      map.off("zoomend", applyArrows);
    };
  }, [overlay, windSlice, tempSlice, ready, simulating, windGlyph, heatmapStyle, radarOn]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = windParticleCanvasRef.current;
    const lift = windGlyphLiftCanvasRef.current;
    if (!map || !ready || !canvas) return;
    const syncLift = () => syncGlyphLiftCanvas(canvas, lift);
    if (!showsWindGlyphs(overlay, radarOn) || windGlyph !== "particles") {
      clearParticleCanvas(canvas);
      syncLift();
      windParticlesRef.current = createParticleField();
      return;
    }
    let raf = 0;
    let last = performance.now();
    let moving = false;
    let viewChanged = true;
    let zoomChanged = true;
    let lastZoom = map.getZoom();
    const onMoveStart = () => {
      moving = true;
      clearParticleCanvas(canvas);
      syncLift();
    };
    const onMoveEnd = () => {
      moving = false;
      viewChanged = true;
      const z = map.getZoom();
      if (Math.abs(z - lastZoom) > 0.01) zoomChanged = true;
      lastZoom = z;
    };
    const onZoomEnd = () => {
      zoomChanged = true;
      lastZoom = map.getZoom();
    };
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const slice = spatialWindSlice(
        windSliceRef.current,
        simulatingRef.current,
      );
      if (slice && !moving) {
        stepWindParticles(canvas, map, slice, windParticlesRef.current, dt, {
          fade: true,
          viewChanged,
          zoomChanged,
        });
        syncLift();
        viewChanged = false;
        zoomChanged = false;
      } else if (!slice) {
        clearParticleCanvas(canvas);
        syncLift();
        windParticlesRef.current = createParticleField();
        viewChanged = true;
        zoomChanged = true;
      }
      raf = requestAnimationFrame(tick);
    };
    map.on("movestart", onMoveStart);
    map.on("moveend", onMoveEnd);
    map.on("zoomend", onZoomEnd);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      map.off("movestart", onMoveStart);
      map.off("moveend", onMoveEnd);
      map.off("zoomend", onZoomEnd);
      clearParticleCanvas(canvas);
      syncLift();
    };
  }, [overlay, ready, windGlyph, radarOn]);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = windParticleCanvasRef.current;
    const lift = windGlyphLiftCanvasRef.current;
    if (!map || !ready || !canvas) return;
    const syncLift = () => syncGlyphLiftCanvas(canvas, lift);
    if (!showsWindGlyphs(overlay, radarOn) || windGlyph !== "arrows") {
      arrowLayoutRef.current = null;
      return;
    }
    const layoutAtZoom = (zoom: number) => {
      const slice = spatialWindSlice(
        windSliceRef.current,
        simulatingRef.current,
      );
      if (!slice) {
        arrowLayoutRef.current = null;
        clearParticleCanvas(canvas);
        syncLift();
        return;
      }
      arrowLayoutRef.current = layoutWindArrows(slice, zoom);
    };
    const paint = () => {
      const fc = arrowLayoutRef.current;
      if (!fc) {
        clearParticleCanvas(canvas);
        syncLift();
        return;
      }
      drawWindArrows(canvas, map, fc);
      syncLift();
    };
    const onZoomEnd = () => {
      layoutAtZoom(map.getZoom());
      paint();
    };
    layoutAtZoom(map.getZoom());
    paint();
    map.on("move", paint);
    map.on("resize", paint);
    map.on("zoomend", onZoomEnd);
    return () => {
      map.off("move", paint);
      map.off("resize", paint);
      map.off("zoomend", onZoomEnd);
    };
  }, [overlay, ready, windGlyph, windSlice, simulating, radarOn]);

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

  useEffect(() => {
    if (!layersOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLayersOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Element && layersRef.current?.contains(e.target)) {
        return;
      }
      setLayersOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [layersOpen]);

  const legendNotes = useMemo(() => {
    if (radarOn) {
      return [
        formatRadarLegend(radarFrame) ?? "Loading radar…",
        "Radar colors are ECCC precip rate (rain mm/h, snow cm/h).",
        "Wind arrows follow the nearest hourly GEM field.",
        stationsOn
          ? "Circles are MSC / NAV CANADA surface stations (SWOB)."
          : null,
      ].filter((line): line is string => !!line);
    }
    const source =
      overlay === "depth"
        ? `Shallow (light) to deep (dark). ${depthIntervalM} m contours.`
        : overlay === "temp"
          ? tempFieldStatus === "loading" || tempFieldStatus === "idle"
            ? "Loading GEM temperature…"
            : tempFieldStatus === "error"
              ? "Temperature field unavailable."
              : simulating
                ? "No simulated temperature."
                : tempSlice
                  ? `GEM 2 m over Alberta (HRDPS, then RDPS / GDPS). ${windGlyph === "arrows" ? "Arrows" : "Particles"} = wind direction.`
                  : "No provincial temperature field this hour."
          : overlay === "wind"
            ? windFieldStatus === "loading" || windFieldStatus === "idle"
              ? "Loading GEM wind field…"
              : windFieldStatus === "error"
                ? "Wind field unavailable."
                : simulating
                  ? `Uniform simulated wind. Color = speed; ${windGlyph === "arrows" ? "arrows" : "particles"} = direction.`
                  : spatialWindSlice(windSlice, false)
                    ? `GEM 10 m over Alberta (HRDPS, then RDPS / GDPS). Color = speed; ${windGlyph === "arrows" ? "arrows" : "particles"} = direction.`
                    : "No provincial wind field this hour."
            : simulating
              ? "Young–Verhagen + effective fetch (steady wind). Wind: simulator."
              : gpxCursor
                ? "Young–Verhagen + effective fetch + duration. Wind: HRDPS (session)."
                : historic
                  ? "Young–Verhagen + effective fetch + duration. Wind: HRDPS (history)."
                  : "Young–Verhagen + effective fetch + duration. Wind: HRDPS ~48 h, then RDPS / GDPS.";
    const hint =
      overlay === "wind" || overlay === "temp"
        ? "Click a lake to select it."
        : forecastPoint
          ? null
          : "Click the lake to pin a forecast spot.";
    const stationNote = stationsOn
      ? "Circles are MSC / NAV CANADA surface stations (SWOB). Click for the latest observation."
      : null;
    return [source, hint, stationNote].filter((line): line is string => !!line);
  }, [
    overlay,
    depthIntervalM,
    tempFieldStatus,
    simulating,
    tempSlice,
    windFieldStatus,
    windGlyph,
    windSlice,
    gpxCursor,
    historic,
    forecastPoint,
    radarOn,
    radarFrame,
    stationsOn,
  ]);

  const fieldSliceReady =
    overlay === "wind"
      ? !!spatialWindSlice(windSlice, simulating)
      : overlay === "temp"
        ? !!tempSlice
        : false;
  const fieldStatusPending =
    overlay === "wind"
      ? windFieldStatus === "loading" || windFieldStatus === "idle"
      : overlay === "temp"
        ? tempFieldStatus === "loading" || tempFieldStatus === "idle"
        : false;
  const heatmapLoading =
    !radarOn &&
    !simulating &&
    showsFieldHeatmap(overlay, radarOn) &&
    (fieldStatusPending || !ready || (fieldSliceReady && !fieldHeatmapReady));
  const heatmapLoadingLabel =
    overlay === "temp" ? "Loading temperature field…" : "Loading wind field…";

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      <canvas
        ref={windParticleCanvasRef}
        className={
          showsWindGlyphs(overlay, radarOn)
            ? "wind-particles is-on is-invert"
            : "wind-particles"
        }
        aria-hidden="true"
      />
      <canvas
        ref={windGlyphLiftCanvasRef}
        className={
          showsWindGlyphs(overlay, radarOn)
            ? "wind-particles is-on is-lift"
            : "wind-particles"
        }
        aria-hidden="true"
      />
      <canvas
        ref={lakeOutlineCanvasRef}
        className="lake-outlines"
        aria-hidden="true"
      />
      {heatmapLoading ? (
        <div className="map-heatmap-loading" role="status">
          <span className="map-heatmap-spinner" aria-hidden="true" />
          {heatmapLoadingLabel}
        </div>
      ) : null}
      {showsFieldHeatmap(overlay, radarOn) ? (
      <div className="map-layers-wrap" ref={layersRef}>
        <button
          type="button"
          className="layers-btn"
          aria-expanded={layersOpen}
          aria-controls="map-layers"
          onClick={() => setLayersOpen((open) => !open)}
        >
          Layers
        </button>
        <div
          id="map-layers"
          className={`map-layers${layersOpen ? " is-open" : ""}`}
        >
        <div className="basemap-toggle heatmap-style-toggle" role="group" aria-label="Heatmap style">
          <button
            type="button"
            className={heatmapStyle === "blend" ? "is-on" : ""}
            aria-pressed={heatmapStyle === "blend"}
            onClick={() => {
              setHeatmapStyle("blend");
              saveHeatmapStyle("blend");
            }}
          >
            Blend
          </button>
          <button
            type="button"
            className={heatmapStyle === "edges" ? "is-on" : ""}
            aria-pressed={heatmapStyle === "edges"}
            onClick={() => {
              setHeatmapStyle("edges");
              saveHeatmapStyle("edges");
            }}
          >
            Edges
          </button>
        </div>
        </div>
      </div>
      ) : null}
      <div className="legend">
        {radarOn ? (
          <>
            <div className="legend-title">
              <span>Radar (mm/h)</span>
              <button
                type="button"
                className={`legend-info${legendTipOpen ? " is-open" : ""}`}
                aria-label={legendNotes.join(" ")}
                aria-expanded={legendTipOpen}
                onClick={() => setLegendTipOpen((open) => !open)}
              >
                <span className="legend-info-mark" aria-hidden>
                  i
                </span>
                <span className="legend-info-tip" role="tooltip">
                  {legendNotes.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </span>
              </button>
            </div>
            <div
              className="legend-bar-hit"
              onPointerMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                if (rect.width <= 0) return;
                setRadarLegendHoverT(
                  Math.max(
                    0,
                    Math.min(1, (e.clientX - rect.left) / rect.width),
                  ),
                );
              }}
              onPointerLeave={() => setRadarLegendHoverT(null)}
            >
              <div
                className="legend-bar"
                style={{ background: radarLegendGradientCss() }}
              />
              {radarLegendHoverT != null && (
                <>
                  <span
                    className="legend-bar-marker"
                    style={{ left: `${radarLegendHoverT * 100}%` }}
                  />
                  <span
                    className={`legend-bar-readout${
                      radarLegendHoverT < 0.12
                        ? " is-start"
                        : radarLegendHoverT > 0.88
                          ? " is-end"
                          : ""
                    }`}
                    style={{ left: `${radarLegendHoverT * 100}%` }}
                  >
                    <span
                      className="legend-bar-swatch"
                      style={{
                        background: `rgb(${sampleRadarLegend(radarLegendHoverT).rgb.join(",")})`,
                      }}
                    />
                    {formatRadarRate(sampleRadarLegend(radarLegendHoverT).rate)}
                  </span>
                </>
              )}
            </div>
            <div className="legend-scale">
              {RADAR_LEGEND_TICK_RATES.map((rate) => (
                <span key={rate}>{formatRadarTick(rate)}</span>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="legend-title">
              <span>
                {overlay === "depth"
                  ? `Depth (${legendUnit(overlay, units)})`
                  : overlay === "wind"
                    ? `Wind speed (${legendUnit(overlay, units)})`
                    : overlay === "temp"
                      ? `Temperature (${legendUnit(overlay, units)})`
                      : `Wave height (${legendUnit(overlay, units)})`}
              </span>
              <button
                type="button"
                className={`legend-info${legendTipOpen ? " is-open" : ""}`}
                aria-label={legendNotes.join(" ")}
                aria-expanded={legendTipOpen}
                onClick={() => setLegendTipOpen((open) => !open)}
              >
                <span className="legend-info-mark" aria-hidden>
                  i
                </span>
                <span className="legend-info-tip" role="tooltip">
                  {legendNotes.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </span>
              </button>
            </div>
            <div
              className="legend-bar-hit"
              onPointerMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                if (rect.width <= 0) return;
                setLegendHoverT(
                  Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
                );
              }}
              onPointerLeave={() => setLegendHoverT(null)}
            >
              <div
                className="legend-bar"
                style={{
                  background: scaleGradientCss(legendScale(overlay)),
                }}
              />
              {legendHoverT != null && (
                <>
                  <span
                    className="legend-bar-marker"
                    style={{ left: `${legendHoverT * 100}%` }}
                  />
                  <span
                    className={`legend-bar-readout${
                      legendHoverT < 0.12
                        ? " is-start"
                        : legendHoverT > 0.88
                          ? " is-end"
                          : ""
                    }`}
                    style={{ left: `${legendHoverT * 100}%` }}
                  >
                    <span
                      className="legend-bar-swatch"
                      style={{
                        background: `rgb(${sampleRgb(legendScale(overlay), legendHoverT).join(",")})`,
                      }}
                    />
                    {formatLegendHover(
                      overlay,
                      legendMin + legendHoverT * (legendMax - legendMin),
                      units,
                    )}
                  </span>
                </>
              )}
            </div>
            <div className="legend-scale">
              {legendStops(legendMin, legendMax).map((value, i) => (
                <span key={`${overlay}-${i}`}>
                  {formatLegendTick(overlay, value, units)}
                </span>
              ))}
            </div>
          </>
        )}
        {forecastPoint ? (
          <button type="button" className="legend-pin-btn" onClick={() => onClearPoint?.()}>
            Pinned spot · Clear
          </button>
        ) : null}
      </div>
      {stationHover && (
        <div
          className="hover-card"
          style={{
            left: Math.min(
              stationHover.x + 14,
              (containerRef.current?.clientWidth ?? 320) - 180,
            ),
            top: Math.max(8, stationHover.y - 8),
          }}
        >
          <div className="hover-primary">
            {stationHover.feature.properties.name}
          </div>
          <div className="hover-primary">
            Wind{" "}
            {stationHover.feature.properties.windSpeedMps != null &&
            stationHover.feature.properties.windDirDeg != null
              ? formatWind(
                  stationHover.feature.properties.windSpeedMps,
                  stationHover.feature.properties.windDirDeg,
                  stationHover.feature.properties.windGustMps,
                  units.wind,
                )
              : "—"}
          </div>
          <div className="hover-primary">
            {stationHover.feature.properties.airTempC != null
              ? formatTemp(stationHover.feature.properties.airTempC, units.temp)
              : "Temp —"}
            {stationHover.feature.properties.relHum != null
              ? ` · ${Math.round(stationHover.feature.properties.relHum)}% RH`
              : ""}
          </div>
          <div className="hover-meta">
            {stationNetworkLabel(
              stationHover.feature.properties.network,
              stationHover.feature.properties.provider,
            )}
            {stationHover.feature.properties.observedAt
              ? ` · ${new Date(stationHover.feature.properties.observedAt).toLocaleString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}`
              : " · no recent obs"}
          </div>
        </div>
      )}
      {hover && !stationHover && (
        <div
          className="hover-card"
          style={{
            left: Math.min(hover.x + 14, (containerRef.current?.clientWidth ?? 320) - 180),
            top: Math.max(8, hover.y - 8),
          }}
        >
          {overlay === "temp" && !radarOn ? (
            <>
              <div className="hover-primary">
                {hover.tempC != null && Number.isFinite(hover.tempC)
                  ? formatTemp(hover.tempC, units.temp)
                  : "Temp —"}
              </div>
              {hover.onWater && (
                <>
                  <div className="hover-primary">
                    Wave{" "}
                    {hover.hsM != null && Number.isFinite(hover.hsM)
                      ? formatWaveHeight(hover.hsM, units.wave)
                      : "—"}
                  </div>
                  <div className="hover-meta">
                    Depth {formatDepth(hover.depthM, units.wave)}
                    {hover.fetchM != null
                      ? ` · Fetch ${(hover.fetchM / 1000).toFixed(1)} km`
                      : ""}
                  </div>
                </>
              )}
            </>
          ) : overlay === "wind" ? (
            <>
              <div className="hover-primary">
                {hover.windSpeedMps != null && hover.windDirDeg != null
                  ? formatWind(
                      hover.windSpeedMps,
                      hover.windDirDeg,
                      hover.gustMps,
                      units.wind,
                    )
                  : "Wind —"}
              </div>
              {hover.onWater && (
                <>
                  <div className="hover-primary">
                    Wave{" "}
                    {hover.hsM != null && Number.isFinite(hover.hsM)
                      ? formatWaveHeight(hover.hsM, units.wave)
                      : "—"}
                  </div>
                  <div className="hover-meta">
                    Depth {formatDepth(hover.depthM, units.wave)}
                    {hover.fetchM != null
                      ? ` · Fetch ${(hover.fetchM / 1000).toFixed(1)} km`
                      : ""}
                  </div>
                </>
              )}
            </>
          ) : overlay === "depth" ? (
            <>
              <div className="hover-primary">
                Depth {formatDepth(hover.depthM, units.wave)}
              </div>
              <div className="hover-primary">
                Wave{" "}
                {hover.hsM != null && Number.isFinite(hover.hsM)
                  ? formatWaveHeight(hover.hsM, units.wave)
                  : "—"}
              </div>
              <div className="hover-meta">
                {hover.fetchM != null
                  ? `Fetch ${(hover.fetchM / 1000).toFixed(1)} km`
                  : ""}
              </div>
            </>
          ) : (
            <>
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
                {hover.fetchM != null
                  ? ` · Fetch ${(hover.fetchM / 1000).toFixed(1)} km`
                  : ""}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
