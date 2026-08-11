import { useEffect, useMemo, useState } from "react";
import { MapView } from "./components/MapView";
import { WindChart } from "./components/WindChart";
import { WaveChart, type ForecastPoint } from "./components/WaveChart";
import { ForecastTimeAxis } from "./components/ForecastTimeAxis";
import {
  loadLakeGrids,
  loadLakeIndex,
  type LakeIndexEntry,
  type SpotProfile,
} from "./lib/lakeAssets";
import {
  fetchHrdpsWind,
  formatWind,
  nearestHourIndex,
  type WindForecast,
} from "./lib/wind";
import {
  fetchLakeSurfaceTemp,
  type LakeSurfaceTemp,
} from "./lib/lswt";
import {
  DEFAULT_UNITS,
  TEMP_UNIT_OPTIONS,
  WAVE_UNIT_OPTIONS,
  WIND_UNIT_OPTIONS,
  formatTemp,
  formatWaveHeight,
  loadUnitPrefs,
  saveUnitPrefs,
  type TempUnit,
  type UnitPrefs,
  type WaveHeightUnit,
  type WindSpeedUnit,
} from "./lib/units";
import {
  computeHsGrid,
  sampleGridNearestWater,
  type LakeGrids,
} from "@chop/wave-engine";
import { sliderInsetStyle } from "./lib/forecastChart";
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
  const [forecastPoint, setForecastPoint] = useState<ForecastPoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [units, setUnits] = useState<UnitPrefs>(() =>
    typeof window !== "undefined" ? loadUnitPrefs() : { ...DEFAULT_UNITS },
  );

  function updateUnits(patch: Partial<UnitPrefs>) {
    setUnits((prev) => {
      const next = { ...prev, ...patch };
      saveUnitPrefs(next);
      return next;
    });
  }

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
    setForecastPoint(null);
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
          setHourIndex(nearestHourIndex(wind.hours));
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

  const selectedHsM = useMemo(() => {
    if (!grids || !wind) return null;
    const hs = computeHsGrid(grids, wind.windSpeedMps, wind.windDirDeg);
    if (forecastPoint) {
      return sampleGridNearestWater(
        hs,
        grids.meta,
        forecastPoint.lon,
        forecastPoint.lat,
      );
    }
    let m = 0;
    for (let i = 0; i < hs.length; i++) {
      const v = hs[i]!;
      if (Number.isFinite(v) && v > m) m = v;
    }
    return m;
  }, [grids, wind, forecastPoint]);

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
        <div className="unit-prefs" title="Display units">
          <label className="unit-picker">
            Wind
            <select
              value={units.wind}
              onChange={(e) =>
                updateUnits({ wind: e.target.value as WindSpeedUnit })
              }
            >
              {WIND_UNIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="unit-picker">
            Waves
            <select
              value={units.wave}
              onChange={(e) =>
                updateUnits({ wave: e.target.value as WaveHeightUnit })
              }
            >
              {WAVE_UNIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="unit-picker">
            Temp
            <select
              value={units.temp}
              onChange={(e) =>
                updateUnits({ temp: e.target.value as TempUnit })
              }
            >
              {TEMP_UNIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
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
            units={units}
            forecastPoint={forecastPoint}
            onChoosePoint={setForecastPoint}
            onClearPoint={() => setForecastPoint(null)}
          />
        )}
      </main>

      <footer className="bottombar">
        <div className="readout">
          <strong>{spot?.identity.name ?? "—"}</strong>
          {wind && <span className="muted">{timeLabel}</span>}
          {wind && (
            <span>
              {formatWind(
                wind.windSpeedMps,
                wind.windDirDeg,
                wind.gustMps,
                units.wind,
              )}
            </span>
          )}
          {selectedHsM != null && (
            <span>
              {forecastPoint ? "Hs" : "max Hs"}{" "}
              {formatWaveHeight(selectedHsM, units.wave)}
            </span>
          )}
          {waterTempStatus === "loading" && (
            <span className="muted">water temp…</span>
          )}
          {waterTempStatus === "ready" && waterTemp && (
            <span title={waterTemp.note}>
              Water {formatTemp(waterTemp.tempC, units.temp)}
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
              windUnit={units.wind}
            />
            {grids && (
              <WaveChart
                hours={forecast.hours}
                hourIndex={hourIndex}
                onSelectHour={setHourIndex}
                grids={grids}
                waveUnit={units.wave}
                sampleAt={forecastPoint}
              />
            )}
            <div className="forecast-plot">
              <div className="forecast-plot-rail" aria-hidden />
              <ForecastTimeAxis
                times={forecast.hours.map((h) => h.time)}
                hourIndex={hourIndex}
                onSelectHour={setHourIndex}
              />
            </div>
            <div className="forecast-plot scrubber-row">
              <div className="forecast-plot-rail scrubber-rail">
                <button
                  type="button"
                  className="now-btn"
                  disabled={hourIndex === nearestHourIndex(forecast.hours)}
                  onClick={() => setHourIndex(nearestHourIndex(forecast.hours))}
                >
                  Now
                </button>
              </div>
              <div
                className="scrubber"
                style={sliderInsetStyle(forecast.hours.length)}
              >
                <input
                  type="range"
                  min={0}
                  max={forecast.hours.length - 1}
                  value={hourIndex}
                  onChange={(e) => setHourIndex(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        )}
      </footer>
    </div>
  );
}
