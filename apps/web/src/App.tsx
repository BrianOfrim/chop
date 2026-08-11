import { useEffect, useMemo, useRef, useState } from "react";
import { MapView } from "./components/MapView";
import { WindChart } from "./components/WindChart";
import { WaveChart, type ForecastPoint } from "./components/WaveChart";
import { ForecastTimeAxis } from "./components/ForecastTimeAxis";
import { WeatherStrip } from "./components/WeatherStrip";
import {
  loadLakeGrids,
  loadLakeIndex,
  type LakeIndexEntry,
  type SpotProfile,
} from "./lib/lakeAssets";
import {
  fetchHrdpsWind,
  fetchHrdpsWindRange,
  formatWind,
  nearestHourIndex,
  type WindForecast,
  type WindHour,
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
import { WindSimPanel } from "./components/WindSimPanel";
import { SessionWaveChart } from "./components/SessionWaveChart";
import { SessionWindChart } from "./components/SessionWindChart";
import { formatWeatherHour, isThunder } from "./lib/weather";
import { parseGpxFile, type GpxTrack } from "./lib/gpx";
import {
  buildSessionSeries,
  sessionDateRange,
  type SessionSample,
} from "./lib/sessionTrack";
import {
  FORECAST_RANGE_OPTIONS,
  loadForecastRange,
  remapHourIndex,
  saveForecastRange,
  sliceForecastHours,
  type ForecastRangeHours,
} from "./lib/forecastRange";
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
  const [simOn, setSimOn] = useState(false);
  const [simSpeedMps, setSimSpeedMps] = useState(8);
  const [simDirDeg, setSimDirDeg] = useState(270);
  const [gpxTrack, setGpxTrack] = useState<GpxTrack | null>(null);
  const [gpxError, setGpxError] = useState<string | null>(null);
  const [sessionHours, setSessionHours] = useState<WindHour[] | null>(null);
  const [sessionSamples, setSessionSamples] = useState<SessionSample[]>([]);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [sessionStatus, setSessionStatus] = useState<
    "idle" | "loading" | "ready" | "no-time" | "error"
  >("idle");
  const gpxInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [units, setUnits] = useState<UnitPrefs>(() =>
    typeof window !== "undefined" ? loadUnitPrefs() : { ...DEFAULT_UNITS },
  );
  const [forecastRange, setForecastRange] = useState<ForecastRangeHours>(() =>
    typeof window !== "undefined" ? loadForecastRange() : 72,
  );

  function updateUnits(patch: Partial<UnitPrefs>) {
    setUnits((prev) => {
      const next = { ...prev, ...patch };
      saveUnitPrefs(next);
      return next;
    });
  }

  function updateForecastRange(next: ForecastRangeHours) {
    if (next === forecastRange) return;
    if (forecast) {
      const prevHours = sliceForecastHours(forecast.hours, forecastRange);
      const nextHours = sliceForecastHours(forecast.hours, next);
      setHourIndex(remapHourIndex(prevHours, hourIndex, nextHours));
    }
    saveForecastRange(next);
    setForecastRange(next);
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
    setGpxTrack(null);
    setGpxError(null);
    setSessionHours(null);
    setSessionSamples([]);
    setSessionIndex(0);
    setSessionStatus("idle");
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
          const visible = sliceForecastHours(wind.hours, loadForecastRange());
          setHourIndex(nearestHourIndex(visible));
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

  const forecastHours = useMemo(
    () =>
      forecast ? sliceForecastHours(forecast.hours, forecastRange) : [],
    [forecast, forecastRange],
  );

  const forecastWind = forecastHours[hourIndex] ?? null;

  async function onGpxPicked(file: File | undefined) {
    if (!file) return;
    setGpxError(null);
    setSessionHours(null);
    setSessionSamples([]);
    setSessionIndex(0);
    setSessionStatus("idle");
    setSimOn(false);
    try {
      const track = await parseGpxFile(file);
      setGpxTrack(track);
      if (!track.startTime || !track.endTime) {
        setSessionStatus("no-time");
        setGpxError(
          "Track has no timestamps — path only. Export a timed GPX to replay conditions.",
        );
      }
    } catch (e) {
      setGpxTrack(null);
      setSessionStatus("idle");
      setGpxError(e instanceof Error ? e.message : String(e));
    }
    if (gpxInputRef.current) gpxInputRef.current.value = "";
  }

  function clearGpx() {
    setGpxTrack(null);
    setGpxError(null);
    setSessionHours(null);
    setSessionSamples([]);
    setSessionIndex(0);
    setSessionStatus("idle");
    if (gpxInputRef.current) gpxInputRef.current.value = "";
  }

  // Load historical HRDPS for the GPX session window
  useEffect(() => {
    if (!gpxTrack || !spot) return;
    const range = sessionDateRange(gpxTrack);
    if (!range) return;

    let cancelled = false;
    setSessionStatus("loading");
    setSessionHours(null);
    setSessionSamples([]);

    const proxy =
      spot.proxyPoints.find(
        (p) =>
          p.role === "background_model_point" ||
          p.role === "open_water_model_point",
      ) ?? spot.proxyPoints[0];
    const lat = proxy?.latitude ?? spot.identity.latitude;
    const lon = proxy?.longitude ?? spot.identity.longitude;

    (async () => {
      try {
        const hist = await fetchHrdpsWindRange(
          lat,
          lon,
          range.startDate,
          range.endDate,
        );
        if (cancelled) return;
        setSessionHours(hist.hours);
        setSessionStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setSessionHours(null);
        setSessionStatus("error");
        setGpxError(
          `Session wind unavailable: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gpxTrack, spot]);

  // Build along-track Hs series once grids + historical hours are ready
  useEffect(() => {
    if (!gpxTrack || !grids || !sessionHours || sessionHours.length === 0) {
      setSessionSamples([]);
      return;
    }
    const samples = buildSessionSeries(gpxTrack, sessionHours, grids);
    setSessionSamples(samples);
    setSessionIndex(0);
    if (samples.length === 0) {
      setSessionStatus("no-time");
      setGpxError(
        "Track has no usable timestamps — path only. Export a timed GPX to replay conditions.",
      );
    }
  }, [gpxTrack, grids, sessionHours]);

  const sessionActive = sessionSamples.length > 0;
  const sessionSample = sessionActive
    ? sessionSamples[Math.min(sessionIndex, sessionSamples.length - 1)] ?? null
    : null;

  function enableSim(on: boolean) {
    if (on && !simOn) {
      const src = sessionSample?.wind ?? forecastWind;
      if (src) {
        setSimSpeedMps(src.windSpeedMps);
        setSimDirDeg(src.windDirDeg);
      }
    }
    setSimOn(on);
  }

  const simWind: WindHour = useMemo(
    () => ({
      time: "sim",
      windSpeedMps: simSpeedMps,
      windDirDeg: simDirDeg,
      gustMps: null,
      weatherCode: null,
      precipMm: 0,
    }),
    [simSpeedMps, simDirDeg],
  );

  const wind = simOn
    ? simWind
    : sessionSample
      ? sessionSample.wind
      : forecastWind;

  const selectedHsM = useMemo(() => {
    if (sessionSample && !simOn) return sessionSample.hsM;
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
  }, [grids, wind, forecastPoint, sessionSample, simOn]);

  const timeLabel = useMemo(() => {
    if (sessionSample && !simOn) {
      return new Date(sessionSample.time).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    }
    if (!wind || wind.time === "sim") return "";
    return new Date(wind.time).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }, [wind, sessionSample, simOn]);

  const wxHour = simOn
    ? null
    : sessionSample
      ? sessionSample.wind
      : forecastWind;

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
        <div className="gpx-picker">
          <input
            ref={gpxInputRef}
            type="file"
            accept=".gpx,application/gpx+xml,text/xml,application/xml"
            className="gpx-input"
            onChange={(e) => void onGpxPicked(e.target.files?.[0])}
          />
          {gpxTrack ? (
            <>
              <span className="gpx-name" title={gpxTrack.filename}>
                {gpxTrack.label}
              </span>
              <button type="button" className="gpx-btn" onClick={clearGpx}>
                Clear track
              </button>
            </>
          ) : (
            <button
              type="button"
              className="gpx-btn"
              onClick={() => gpxInputRef.current?.click()}
            >
              Upload GPX
            </button>
          )}
        </div>
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
        {gpxError && <div className="banner error">{gpxError}</div>}
        {loading && <div className="banner">Loading lake & HRDPS wind…</div>}
        {sessionStatus === "loading" && (
          <div className="banner">Loading HRDPS wind for session…</div>
        )}
        {grids && spot && shoreline && (
          <MapView
            key={lakeId}
            grids={grids}
            spot={spot}
            shoreline={shoreline}
            wind={wind}
            units={units}
            simulating={simOn}
            forecastPoint={forecastPoint}
            gpxTrack={gpxTrack}
            gpxCursor={
              sessionSample && !simOn
                ? { lon: sessionSample.lon, lat: sessionSample.lat }
                : null
            }
            onChoosePoint={setForecastPoint}
            onClearPoint={() => setForecastPoint(null)}
          />
        )}
        <WindSimPanel
          active={simOn}
          onActiveChange={enableSim}
          speedMps={simSpeedMps}
          dirDeg={simDirDeg}
          onSpeedMps={setSimSpeedMps}
          onDirDeg={setSimDirDeg}
          windUnit={units.wind}
        />
      </main>

      <footer className="bottombar">
        <div className="readout-row">
          <div className="readout">
            <strong>{spot?.identity.name ?? "—"}</strong>
            {simOn ? (
              <span className="sim-badge">Sim</span>
            ) : sessionActive ? (
              <span className="session-badge">Session</span>
            ) : (
              wind && <span className="muted">{timeLabel}</span>
            )}
            {(sessionActive || simOn) && wind && (
              <span className="muted">{timeLabel}</span>
            )}
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
            {wxHour && (
              <span
                className={
                  isThunder(wxHour.weatherCode)
                    ? "wx-readout thunder"
                    : undefined
                }
              >
                {formatWeatherHour(wxHour.weatherCode, wxHour.precipMm)}
              </span>
            )}
            {selectedHsM != null && (
              <span>
                {sessionActive && !simOn
                  ? "Hs at you"
                  : forecastPoint
                    ? "Hs"
                    : "max Hs"}{" "}
                {formatWaveHeight(selectedHsM, units.wave)}
              </span>
            )}
            {gpxTrack && (
              <span className="muted" title={gpxTrack.filename}>
                Track {gpxTrack.label}
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
          <div
            className="range-toggle"
            role="group"
            aria-label="Forecast range"
            title={
              sessionActive
                ? "Forecast range applies after clearing the GPX session"
                : "Forward forecast duration (always includes the past 24 hours)"
            }
          >
            {FORECAST_RANGE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={forecastRange === o.value ? "is-on" : ""}
                aria-pressed={forecastRange === o.value}
                disabled={sessionActive}
                onClick={() => updateForecastRange(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        {sessionActive ? (
          <div className={`forecast-panel${simOn ? " is-sim" : ""}`}>
            <SessionWindChart
              samples={sessionSamples}
              sampleIndex={sessionIndex}
              onSelectSample={setSessionIndex}
              windUnit={units.wind}
            />
            <SessionWaveChart
              samples={sessionSamples}
              sampleIndex={sessionIndex}
              onSelectSample={setSessionIndex}
              waveUnit={units.wave}
            />
            <div className="forecast-plot scrubber-row">
              <div className="forecast-plot-rail scrubber-rail">
                <button
                  type="button"
                  className="now-btn"
                  disabled={sessionIndex === 0}
                  onClick={() => setSessionIndex(0)}
                >
                  Start
                </button>
              </div>
              <div
                className="scrubber"
                style={sliderInsetStyle(sessionSamples.length)}
              >
                <input
                  type="range"
                  min={0}
                  max={sessionSamples.length - 1}
                  value={sessionIndex}
                  onChange={(e) => setSessionIndex(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        ) : (
          forecastHours.length > 0 && (
            <div className={`forecast-panel${simOn ? " is-sim" : ""}`}>
              <WindChart
                hours={forecastHours}
                hourIndex={hourIndex}
                onSelectHour={setHourIndex}
                windUnit={units.wind}
              />
              {grids && (
                <WaveChart
                  hours={forecastHours}
                  hourIndex={hourIndex}
                  onSelectHour={setHourIndex}
                  grids={grids}
                  waveUnit={units.wave}
                  sampleAt={forecastPoint}
                />
              )}
              <WeatherStrip
                hours={forecastHours}
                hourIndex={hourIndex}
                onSelectHour={setHourIndex}
              />
              <div className="forecast-plot">
                <div className="forecast-plot-rail" aria-hidden />
                <ForecastTimeAxis
                  times={forecastHours.map((h) => h.time)}
                  hourIndex={hourIndex}
                  onSelectHour={setHourIndex}
                />
              </div>
              <div className="forecast-plot scrubber-row">
                <div className="forecast-plot-rail scrubber-rail">
                  <button
                    type="button"
                    className="now-btn"
                    disabled={hourIndex === nearestHourIndex(forecastHours)}
                    onClick={() =>
                      setHourIndex(nearestHourIndex(forecastHours))
                    }
                  >
                    Now
                  </button>
                </div>
                <div
                  className="scrubber"
                  style={sliderInsetStyle(forecastHours.length)}
                >
                  <input
                    type="range"
                    min={0}
                    max={forecastHours.length - 1}
                    value={hourIndex}
                    onChange={(e) => setHourIndex(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>
          )
        )}
      </footer>
    </div>
  );
}
