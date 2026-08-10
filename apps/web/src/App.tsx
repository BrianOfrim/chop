import { useEffect, useMemo, useState } from "react";
import { MapView } from "./components/MapView";
import { WindChart } from "./components/WindChart";
import {
  loadLakeGrids,
  loadLakeIndex,
  type LakeIndexEntry,
  type SpotProfile,
} from "./lib/lakeAssets";
import { fetchHrdpsWind, formatWind, type WindForecast } from "./lib/wind";
import {
  fetchLakeSurfaceTemp,
  formatWaterTemp,
  type LakeSurfaceTemp,
} from "./lib/lswt";
import type { LakeGrids } from "@chop/wave-engine";
import "./App.css";

export default function App() {
  const [lakes, setLakes] = useState<LakeIndexEntry[]>([]);
  const [lakeId, setLakeId] = useState("ca-ab-pigeon-lake");
  const [grids, setGrids] = useState<LakeGrids | null>(null);
  const [spot, setSpot] = useState<SpotProfile | null>(null);
  const [shoreline, setShoreline] = useState<GeoJSON.FeatureCollection | null>(
    null,
  );
  const [forecast, setForecast] = useState<WindForecast | null>(null);
  const [waterTemp, setWaterTemp] = useState<LakeSurfaceTemp | null>(null);
  const [waterTempStatus, setWaterTempStatus] = useState<
    "idle" | "loading" | "ready" | "unavailable"
  >("idle");
  const [hourIndex, setHourIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLakeIndex()
      .then((list) => setLakes(list.filter((l) => l.enabled)))
      .catch((e) => setError(String(e)));
  }, []);

  // Decouple asset load from wind so the map shows even if HRDPS is slow/fails
  useEffect(() => {
    const entry = lakes.find((l) => l.id === lakeId);
    if (!entry) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setForecast(null);
    setWaterTemp(null);
    setWaterTempStatus("idle");
    setGrids(null);
    setSpot(null);
    setShoreline(null);
    (async () => {
      try {
        const loaded = await loadLakeGrids(entry.path);
        if (cancelled) return;
        setGrids(loaded.grids);
        setSpot(loaded.spot);
        setShoreline(loaded.shoreline);
        setLoading(false);

        const proxy =
          loaded.spot.proxyPoints.find(
            (p) =>
              p.role === "background_model_point" ||
              p.role === "open_water_model_point",
          ) ?? loaded.spot.proxyPoints[0];
        const lat = proxy?.latitude ?? loaded.spot.identity.latitude;
        const lon = proxy?.longitude ?? loaded.spot.identity.longitude;

        setWaterTempStatus("loading");
        fetchLakeSurfaceTemp(lat, lon)
          .then((temp) => {
            if (cancelled) return;
            if (temp) {
              setWaterTemp(temp);
              setWaterTempStatus("ready");
            } else {
              setWaterTemp(null);
              setWaterTempStatus("unavailable");
            }
          })
          .catch(() => {
            if (!cancelled) {
              setWaterTemp(null);
              setWaterTempStatus("unavailable");
            }
          });

        try {
          const wind = await fetchHrdpsWind(lat, lon);
          if (cancelled) return;
          setForecast(wind);
          const now = Date.now();
          let best = 0;
          let bestDiff = Infinity;
          wind.hours.forEach((h, i) => {
            const d = Math.abs(new Date(h.time).getTime() - now);
            if (d < bestDiff) {
              bestDiff = d;
              best = i;
            }
          });
          setHourIndex(best);
        } catch (windErr) {
          if (!cancelled) {
            setError(`Wind forecast unavailable: ${String(windErr)}`);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lakeId, lakes]);

  const wind = forecast?.hours[hourIndex] ?? null;

  const timeLabel = useMemo(() => {
    if (!wind) return "";
    return new Date(wind.time).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }, [wind]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">chop</span>
          <span className="brand-sub">inland lake waves</span>
        </div>
        <label className="lake-picker">
          Lake
          <select
            value={lakeId}
            onChange={(e) => setLakeId(e.target.value)}
            disabled={lakes.length === 0}
          >
            {lakes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      <main className="main">
        {error && <div className="banner error">{error}</div>}
        {loading && <div className="banner">Loading lake & HRDPS wind…</div>}
        {grids && spot && shoreline && (
          <MapView
            key={lakeId}
            grids={grids}
            spot={spot}
            shoreline={shoreline}
            wind={wind}
          />
        )}

      </main>

      <footer className="bottombar">
        <div className="readout">
          <strong>{spot?.identity.name ?? "—"}</strong>
          {wind && (
            <>
              <span>
                {formatWind(wind.windSpeedMps, wind.windDirDeg, wind.gustMps)}
              </span>
              <span className="muted">{timeLabel}</span>
              <span className="muted">model {forecast?.model}</span>
            </>
          )}
          {waterTempStatus === "loading" && (
            <span className="muted">water temp…</span>
          )}
          {waterTempStatus === "ready" && waterTemp && (
            <span title={waterTemp.note}>
              Water {formatWaterTemp(waterTemp.tempC)}
              <span className="muted">
                {" "}
                MODIS {waterTemp.product === "LST_Night_1km" ? "night" : "day"}{" "}
                {waterTemp.date}
              </span>
            </span>
          )}
          {waterTempStatus === "unavailable" && (
            <span className="muted" title="No clear-sky MODIS LST in the last ~3 weeks">
              Water temp unavailable
            </span>
          )}
        </div>
        {forecast && forecast.hours.length > 0 && (
          <div className="forecast-panel">
            <WindChart
              hours={forecast.hours}
              hourIndex={hourIndex}
              onSelectHour={setHourIndex}
            />
            <div className="scrubber">
              <input
                type="range"
                min={0}
                max={forecast.hours.length - 1}
                value={hourIndex}
                onChange={(e) => setHourIndex(Number(e.target.value))}
              />
            </div>
          </div>
        )}
      </footer>
    </div>
  );
}
