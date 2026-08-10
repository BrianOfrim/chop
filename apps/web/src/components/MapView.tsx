import { useEffect, useMemo, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
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
import { hsToImageData, makeArrowIcon, suggestVmax } from "../lib/hsOverlay";
import type { WindHour } from "../lib/wind";

type Props = {
  grids: LakeGrids;
  spot: SpotProfile;
  shoreline: GeoJSON.FeatureCollection;
  wind: WindHour | null;
};

type HoverInfo = {
  lon: number;
  lat: number;
  hsM: number | null;
  depthM: number | null;
  fetchM: number | null;
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

export function MapView({ grids, spot, shoreline, wind }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const hsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hsRef = useRef<Float32Array | null>(null);
  const windRef = useRef<WindHour | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [ready, setReady] = useState(false);

  const hs = useMemo(() => {
    if (!wind) return null;
    return computeHsGrid(grids, wind.windSpeedMps, wind.windDirDeg);
  }, [grids, wind]);

  hsRef.current = hs;
  windRef.current = wind;

  const vmax = useMemo(() => (hs ? suggestVmax(hs) : 0.6), [hs]);

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
          "icon-size": 0.85,
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      });

      setReady(true);
    });

    map.on("mousemove", (e: MapMouseEvent) => {
      const { lng, lat } = e.lngLat;
      const depthM = sampleGrid(grids.depth, grids.meta, lng, lat);
      const currentHs = hsRef.current;
      const currentWind = windRef.current;
      const hsM = currentHs ? sampleGrid(currentHs, grids.meta, lng, lat) : null;
      let fetchM: number | null = null;
      if (depthM != null && currentWind) {
        const { ncols, nrows, west, south, east, north } = grids.meta;
        const fx = ((lng - west) / (east - west)) * ncols;
        const fy = ((north - lat) / (north - south)) * nrows;
        const i = Math.min(ncols - 1, Math.max(0, Math.floor(fx)));
        const j = Math.min(nrows - 1, Math.max(0, Math.floor(fy)));
        const idx = j * ncols + i;
        if (grids.depth[idx]! > 0) {
          fetchM = fetchAtDir(grids.fetch, grids.meta, idx, currentWind.windDirDeg);
        }
      }
      setHover({ lon: lng, lat, hsM, depthM, fetchM });
    });

    const onResize = () => map.resize();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
      hsCanvasRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = hsCanvasRef.current;
    if (!ready || !hs || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
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
    // Single mid-lake arrow; points where the wind is going (TO)
    const toBearing = (wind.windDirDeg + 180) % 360;
    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { bearing: toBearing },
          geometry: {
            type: "Point",
            coordinates: [spot.identity.longitude, spot.identity.latitude],
          },
        },
      ],
    });
  }, [wind, ready, spot]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = (spot.ridePoints ?? []).map((rp) => {
      const el = document.createElement("div");
      el.className = "ride-marker";
      el.title = rp.name;
      el.textContent = "•";
      return new Marker({ element: el })
        .setLngLat([rp.longitude, rp.latitude])
        .setPopup(new Popup({ offset: 8 }).setText(rp.name))
        .addTo(map);
    });
  }, [spot, ready]);

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
      {hover?.depthM != null && (
        <div className="hover-card">
          <div>
            {hover.lat.toFixed(4)}, {hover.lon.toFixed(4)}
          </div>
          <div>Depth {hover.depthM.toFixed(1)} m</div>
          {hover.fetchM != null && <div>Fetch {(hover.fetchM / 1000).toFixed(1)} km</div>}
          <div>
            Hs{" "}
            {hover.hsM != null && Number.isFinite(hover.hsM)
              ? `${(hover.hsM * 100).toFixed(0)} cm`
              : "—"}
          </div>
        </div>
      )}
    </div>
  );
}
