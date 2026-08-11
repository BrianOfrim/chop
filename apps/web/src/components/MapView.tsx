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
import type { SpotProfile } from "../lib/lakeAssets";
import { hsToImageData, makeArrowIcon, HS_COLOR_MAX_M } from "../lib/hsOverlay";
import {
  buildShoreMaskCanvas,
  hsCanvasSize,
  paintHsClipped,
} from "../lib/shoreMask";
import { formatWind, formatWindMapLabel, type WindHour } from "../lib/wind";
import { windColorRgb } from "../lib/windScale";
import {
  formatWaveHeight,
  type UnitPrefs,
} from "../lib/units";
import { DEFAULT_WAVE_SCALE, scaleGradientCss } from "../lib/colorScales";

type Props = {
  grids: LakeGrids;
  spot: SpotProfile;
  shoreline: GeoJSON.FeatureCollection;
  wind: WindHour | null;
  units: UnitPrefs;
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

/** Simple raster basemap — more reliable than remote vector styles. */
const STYLE: StyleSpecification = {
  version: 8,
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
  },
  layers: [
    {
      id: "carto",
      type: "raster",
      source: "carto",
      minzoom: 0,
      maxzoom: 20,
    },
  ],
};

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

export function MapView({ grids, spot, shoreline, wind, units }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const hsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const shoreMaskRef = useRef<HTMLCanvasElement | null>(null);
  const hsRef = useRef<Float32Array | null>(null);
  const windRef = useRef<WindHour | null>(null);
  const gridsRef = useRef(grids);
  const shorelineRef = useRef(shoreline);
  const userMovedRef = useRef(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [ready, setReady] = useState(false);

  gridsRef.current = grids;
  shorelineRef.current = shoreline;

  const hs = useMemo(() => {
    if (!wind) return null;
    return computeHsGrid(grids, wind.windSpeedMps, wind.windDirDeg);
  }, [grids, wind]);

  hsRef.current = hs;
  windRef.current = wind;

  const vmax = HS_COLOR_MAX_M;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const { meta } = grids;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE,
      center: [spot.identity.longitude, spot.identity.latitude],
      zoom: 11.2,
    });
    map.addControl(new NavigationControl({ visualizePitch: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      map.resize();

      map.addSource("shoreline", { type: "geojson", data: shoreline });
      map.addLayer({
        id: "shoreline-fill",
        type: "fill",
        source: "shoreline",
        paint: {
          "fill-color": "#0b3a4a",
          "fill-opacity": 0.06,
        },
      });
      map.addLayer({
        id: "shoreline-line",
        type: "line",
        source: "shoreline",
        paint: {
          "line-color": "#163a44",
          "line-width": 1.6,
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

      fitLake(map, meta, shoreline, 0);
      setReady(true);
    });

    map.on("movestart", (e) => {
      if (e.originalEvent) userMovedRef.current = true;
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

    map.on("mouseout", () => setHover(null));

    const syncWindLabelOffset = () => {
      if (!map.getLayer("wind-dir")) return;
      map.setLayoutProperty("wind-dir", "text-offset", windLabelOffsetEms(map.getZoom()));
    };
    map.on("zoom", syncWindLabelOffset);

    const refitIfNeeded = () => {
      map.resize();
      if (!userMovedRef.current) {
        fitLake(map, gridsRef.current.meta, shorelineRef.current, 0);
      }
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

    const shoreSrc = map.getSource("shoreline") as GeoJSONSource | undefined;
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

    userMovedRef.current = false;
    fitLake(map, meta, shoreline, 0);
  }, [grids, shoreline, ready]);

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
    if (!ready || !hs || !canvas) return;
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
    paintHsClipped(
      ctx,
      hsToImageData(hs, grids.meta, vmax, DEFAULT_WAVE_SCALE),
      mask,
    );
  }, [hs, ready, grids.meta, vmax]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("wind-dir") as GeoJSONSource | undefined;
    if (!src) return;
    if (!wind) {
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
  }, [wind, ready, grids.meta, units.wind]);

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      <div className="legend">
        <div className="legend-title">Wave height Hs</div>
        <div
          className="legend-bar"
          style={{ background: scaleGradientCss(DEFAULT_WAVE_SCALE) }}
        />
        <div className="legend-scale">
          <span>0</span>
          <span>{formatWaveHeight(vmax, units.wave)}</span>
        </div>
        <p className="legend-note">SMB fetch-limited + depth cap. Wind: HRDPS.</p>
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
            Depth {hover.depthM.toFixed(1)} m
            {hover.fetchM != null ? ` · Fetch ${(hover.fetchM / 1000).toFixed(1)} km` : ""}
          </div>
        </div>
      )}
    </div>
  );
}
