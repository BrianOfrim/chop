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
import { formatWind, formatWindMapLabel, type WindHour } from "../lib/wind";

type Props = {
  grids: LakeGrids;
  spot: SpotProfile;
  shoreline: GeoJSON.FeatureCollection;
  wind: WindHour | null;
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

function fitLake(map: MapLibreMap, meta: LakeGrids["meta"]) {
  map.fitBounds(
    [
      [meta.west, meta.south],
      [meta.east, meta.north],
    ],
    { padding: { top: 56, bottom: 56, left: 56, right: 96 }, duration: 700, maxZoom: 12.5 },
  );
}

/** Place the wind arrow just east of the lake so it does not cover the Hs field. */
function windArrowLngLat(meta: LakeGrids["meta"]): [number, number] {
  const midLat = (meta.north + meta.south) / 2;
  const width = Math.max(meta.east - meta.west, 0.01);
  return [meta.east + width * 0.16, midLat];
}

export function MapView({ grids, spot, shoreline, wind }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const hsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hsRef = useRef<Float32Array | null>(null);
  const windRef = useRef<WindHour | null>(null);
  const gridsRef = useRef(grids);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [ready, setReady] = useState(false);

  gridsRef.current = grids;

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
      canvas.width = meta.ncols;
      canvas.height = meta.nrows;
      hsCanvasRef.current = canvas;
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

      if (!map.hasImage("wind-arrow")) {
        map.addImage("wind-arrow", makeArrowIcon(128));
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
          "text-size": 12,
          "text-offset": [0, 1.65],
          "text-anchor": "top",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": "#1c201e",
          "text-halo-color": "rgba(255,255,255,0.92)",
          "text-halo-width": 1.4,
        },
      });

      fitLake(map, meta);
      setReady(true);
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

    const onResize = () => map.resize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
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
    if (canvas.width !== meta.ncols || canvas.height !== meta.nrows) {
      canvas.width = meta.ncols;
      canvas.height = meta.nrows;
    }
    const hsSrc = map.getSource("hs") as CanvasSource | undefined;
    hsSrc?.setCoordinates(hsCoordinates(meta));

    fitLake(map, meta);
  }, [grids, shoreline, ready]);

  useEffect(() => {
    const canvas = hsCanvasRef.current;
    if (!ready || !hs || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (canvas.width !== grids.meta.ncols || canvas.height !== grids.meta.nrows) {
      canvas.width = grids.meta.ncols;
      canvas.height = grids.meta.nrows;
    }
    ctx.putImageData(hsToImageData(hs, grids.meta, vmax), 0, 0);
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
            label: formatWindMapLabel(wind.windSpeedMps, wind.gustMps),
          },
          geometry: {
            type: "Point",
            coordinates: windArrowLngLat(grids.meta),
          },
        },
      ],
    });
  }, [wind, ready, grids.meta]);

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      <div className="legend">
        <div className="legend-title">Wave height Hs</div>
        <div className="legend-bar" />
        <div className="legend-scale">
          <span>0</span>
          <span>{(vmax * 100).toFixed(0)} cm</span>
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
              ? `${(hover.hsM * 100).toFixed(0)} cm`
              : "—"}
          </div>
          <div className="hover-primary">
            Wind{" "}
            {hover.windSpeedMps != null && hover.windDirDeg != null
              ? formatWind(
                  hover.windSpeedMps,
                  hover.windDirDeg,
                  hover.gustMps,
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
