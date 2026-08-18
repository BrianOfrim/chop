import { useEffect, useMemo, useRef, useState } from "react";
import { MapView } from "./components/MapView";
import { WindChart } from "./components/WindChart";
import { WaveChart, type ForecastPoint } from "./components/WaveChart";
import { ForecastTimeAxis } from "./components/ForecastTimeAxis";
import { WeatherStrip } from "./components/WeatherStrip";
import {
  loadAllLakeShorelines,
  loadLakeGrids,
  loadLakeIndex,
  shorelineBoundsByLake,
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
  applyHrdpsFieldToHours,
  fetchAlbertaWindField,
  fetchAlbertaWindFieldRange,
  HRDPS_HANDOFF_MS,
  sampleWindField,
  sliceWindField,
  uniformWindSlice,
  type WindField,
} from "./lib/windField";
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
import {
  SessionSpeedChart,
  sessionSpeedLabel,
} from "./components/SessionSpeedChart";
import { formatWeatherHour, isThunder } from "./lib/weather";
import { parseGpxFile, type GpxTrack } from "./lib/gpx";
import { StravaPanel } from "./components/StravaPanel";
import {
  buildSessionSeries,
  sessionDateRange,
  sessionPointLabel,
  type SessionSample,
} from "./lib/sessionTrack";
import { SessionPointChart } from "./components/SessionPointChart";
import { CollapsiblePlot } from "./components/CollapsiblePlot";
import {
  FORECAST_RANGE_OPTIONS,
  loadForecastRange,
  remapHourIndex,
  saveForecastRange,
  sliceForecastHours,
  type ForecastRangeHours,
} from "./lib/forecastRange";
import {
  historySpan,
  historyViewLabel,
  maxHistoryOffsetDays,
  sliceHistoryView,
  type WindMode,
} from "./lib/historyRange";
import "./App.css";

const REVIEW_FOLLOW_KEY = "chop.reviewFollow";

function loadReviewFollow(): boolean {
  try {
    return localStorage.getItem(REVIEW_FOLLOW_KEY) === "1";
  } catch {
    return false;
  }
}

function saveReviewFollow(on: boolean): void {
  try {
    localStorage.setItem(REVIEW_FOLLOW_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [lakes, setLakes] = useState<LakeIndexEntry[]>([]);
  const [lakeId, setLakeId] = useState("ca-ab-pigeon-lake");
  const [grids, setGrids] = useState<LakeGrids | null>(null);
  const [spot, setSpot] = useState<SpotProfile | null>(null);
  const [shoreline, setShoreline] = useState<GeoJSON.FeatureCollection | null>(
    null,
  );
  const [depthContours, setDepthContours] =
    useState<GeoJSON.FeatureCollection | null>(null);
  const [allShorelines, setAllShorelines] =
    useState<GeoJSON.FeatureCollection | null>(null);
  const [forecast, setForecast] = useState<WindForecast | null>(null);
  const [waterTemp, setWaterTemp] = useState<LakeSurfaceTemp | null>(null);
  const [waterTempStatus, setWaterTempStatus] = useState<
    "idle" | "loading" | "ready" | "unavailable"
  >("idle");
  const [hourIndex, setHourIndex] = useState(0);
  const [forecastPoint, setForecastPoint] = useState<ForecastPoint | null>(null);
  const [mode, setMode] = useState<WindMode>("forecast");
  const [simSpeedMps, setSimSpeedMps] = useState(8);
  const [simDirDeg, setSimDirDeg] = useState(270);
  const [history, setHistory] = useState<WindForecast | null>(null);
  const [historyStatus, setHistoryStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [historyOffsetDays, setHistoryOffsetDays] = useState(0);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [gpxTrack, setGpxTrack] = useState<GpxTrack | null>(null);
  const [gpxError, setGpxError] = useState<string | null>(null);
  const [sessionHours, setSessionHours] = useState<WindHour[] | null>(null);
  const [sessionSamples, setSessionSamples] = useState<SessionSample[]>([]);
  const [sessionIndex, setSessionIndex] = useState(0);
  const [sessionStatus, setSessionStatus] = useState<
    "idle" | "loading" | "ready" | "no-time" | "error"
  >("idle");
  const [reviewFollow, setReviewFollow] = useState(loadReviewFollow);
  const pendingSessionRef = useRef<GpxTrack | null>(null);
  const gpxInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [units, setUnits] = useState<UnitPrefs>(() =>
    typeof window !== "undefined" ? loadUnitPrefs() : { ...DEFAULT_UNITS },
  );
  const [forecastRange, setForecastRange] = useState<ForecastRangeHours>(() =>
    typeof window !== "undefined" ? loadForecastRange() : 72,
  );
  const [forecastWindField, setForecastWindField] = useState<WindField | null>(
    null,
  );
  const [forecastWindStatus, setForecastWindStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const rangeWindCacheRef = useRef<Map<string, WindField>>(new Map());
  const [rangeWindField, setRangeWindField] = useState<WindField | null>(null);
  const [rangeWindStatus, setRangeWindStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [needWindField, setNeedWindField] = useState(false);

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

  useEffect(() => {
    if (forecastWindField) return;
    if (forecastWindStatus === "error") return;
    let cancelled = false;
    setForecastWindStatus("loading");
    fetchAlbertaWindField()
      .then((field) => {
        if (cancelled) return;
        setForecastWindField(field);
        setForecastWindStatus("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("Alberta wind field failed", e);
        setForecastWindField(null);
        setForecastWindStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [forecastWindField, forecastWindStatus]);

  useEffect(() => {
    if (forecastWindStatus !== "error") return;
    const id = window.setTimeout(() => setForecastWindStatus("idle"), 120_000);
    return () => window.clearTimeout(id);
  }, [forecastWindStatus]);

  useEffect(() => {
    if (lakes.length === 0) return;
    let cancelled = false;
    loadAllLakeShorelines(lakes)
      .then((fc) => {
        if (!cancelled) setAllShorelines(fc);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [lakes]);

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
    setForecastPoint(null);
    const keepSession = pendingSessionRef.current != null;
    if (!keepSession) {
      setGpxTrack(null);
      setGpxError(null);
      setSessionHours(null);
      setSessionSamples([]);
      setSessionIndex(0);
      setSessionStatus("idle");
      setMode("forecast");
    } else {
      setSessionHours(null);
      setSessionSamples([]);
      setSessionIndex(0);
      setSessionStatus("idle");
    }
    setHistory(null);
    setHistoryStatus("idle");
    setHistoryOffsetDays(0);
    setHistoryIndex(0);
    (async () => {
      try {
        const loaded = await loadLakeGrids(entry.path);
        if (cancelled) return;
        setGrids(loaded.grids);
        setSpot(loaded.spot);
        setShoreline(loaded.shoreline);
        setDepthContours(loaded.depthContours);
        setLoading(false);
        if (pendingSessionRef.current) {
          pendingSessionRef.current = null;
          setMode("review");
        }

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

  const lakeWindAt = useMemo(() => {
    if (!spot) return null;
    const proxy =
      spot.proxyPoints.find(
        (p) =>
          p.role === "background_model_point" ||
          p.role === "open_water_model_point",
      ) ?? spot.proxyPoints[0];
    return {
      lat: proxy?.latitude ?? spot.identity.latitude,
      lon: proxy?.longitude ?? spot.identity.longitude,
    };
  }, [spot]);

  const forecastHours = useMemo(() => {
    const sliced = forecast
      ? sliceForecastHours(forecast.hours, forecastRange)
      : [];
    if (!lakeWindAt) return sliced;
    return applyHrdpsFieldToHours(
      sliced,
      forecastWindField,
      lakeWindAt.lon,
      lakeWindAt.lat,
    );
  }, [forecast, forecastRange, forecastWindField, lakeWindAt]);

  const historyHours = useMemo(
    () =>
      history ? sliceHistoryView(history.hours, historyOffsetDays) : [],
    [history, historyOffsetDays],
  );

  const chartHours =
    mode === "history" ? historyHours : forecastHours;
  const chartIndex = mode === "history" ? historyIndex : hourIndex;
  const setChartIndex =
    mode === "history" ? setHistoryIndex : setHourIndex;

  const forecastWind = forecastHours[hourIndex] ?? null;
  const historyWind = historyHours[historyIndex] ?? null;

  function applyTrack(track: GpxTrack) {
    setGpxError(null);
    setSessionHours(null);
    setSessionSamples([]);
    setSessionIndex(0);
    setSessionStatus("idle");
    setMode("review");
    setGpxTrack(track);
    if (!track.startTime || !track.endTime) {
      setSessionStatus("no-time");
      setGpxError(
        "Track has no timestamps — path only. Export a timed GPX to replay conditions.",
      );
    }
  }

  function onStravaTrack(track: GpxTrack, atLakeId: string | null) {
    applyTrack(track);
    if (atLakeId && atLakeId !== lakeId) {
      pendingSessionRef.current = track;
      setLakeId(atLakeId);
    }
  }

  async function onGpxPicked(file: File | undefined) {
    if (!file) return;
    try {
      applyTrack(await parseGpxFile(file));
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

  // Load 90-day HRDPS archive when entering History mode (cached per lake).
  // Important: do not bail on historyStatus==="loading" — React Strict Mode
  // remounts effects and would otherwise leave the UI stuck loading forever.
  useEffect(() => {
    if (mode !== "history" || !spot) return;
    if (history) return;

    let cancelled = false;
    setHistoryStatus("loading");
    const span = historySpan();
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
          span.startDate,
          span.endDate,
        );
        if (cancelled) return;
        setHistory(hist);
        setHistoryStatus("ready");
        setHistoryOffsetDays(0);
        const view = sliceHistoryView(hist.hours, 0);
        setHistoryIndex(nearestHourIndex(view));
      } catch (e) {
        if (cancelled) return;
        console.error("History fetch failed", e);
        setHistory(null);
        setHistoryStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, spot, history]);

  useEffect(() => {
    if (mode !== "history" || historyHours.length === 0) return;
    setHistoryIndex(historyHours.length - 1);
  }, [mode, historyOffsetDays, historyHours.length]);

  const reviewActive =
    mode === "review" && sessionSamples.length > 0;
  const sessionSample = reviewActive
    ? sessionSamples[Math.min(sessionIndex, sessionSamples.length - 1)] ?? null
    : null;
  const reviewSpeedLabel = sessionSpeedLabel(
    sessionSample?.speedMps,
    units.wind,
  );
  const reviewPointLabel = sessionPointLabel(sessionSample?.pointDeg);

  function changeMode(next: WindMode) {
    if (next === "sim" && mode !== "sim") {
      const src =
        mode === "history"
          ? historyWind
          : mode === "review"
            ? (sessionSample?.wind ?? forecastWind)
            : forecastWind;
      if (src) {
        setSimSpeedMps(src.windSpeedMps);
        setSimDirDeg(src.windDirDeg);
      }
    }
    if (next === "history" && historyStatus === "error") {
      setHistoryStatus("idle");
    }
    setMode(next);
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

  const wind =
    mode === "sim"
      ? simWind
      : mode === "review" && sessionSample
        ? sessionSample.wind
        : mode === "history"
          ? historyWind
          : (() => {
              if (!forecastWind) return null;
              if (!forecastPoint || !forecastWindField) return forecastWind;
              const slice = sliceWindField(
                forecastWindField,
                forecastWind.time,
                HRDPS_HANDOFF_MS,
              );
              if (!slice) return forecastWind;
              const s = sampleWindField(
                slice,
                forecastPoint.lon,
                forecastPoint.lat,
              );
              if (!s) return forecastWind;
              return {
                ...forecastWind,
                windSpeedMps: s.speedMps,
                windDirDeg: s.dirDeg,
              };
            })();

  const neededWindRange = useMemo(() => {
    if (!needWindField) return null;
    if (mode === "history") {
      if (historyHours.length === 0) return null;
      return {
        startDate: historyHours[0]!.time.slice(0, 10),
        endDate: historyHours[historyHours.length - 1]!.time.slice(0, 10),
      };
    }
    if (mode === "review" && gpxTrack) {
      if (forecastWindStatus === "loading") return null;
      const range = sessionDateRange(gpxTrack);
      if (!range) return null;
      const t = sessionSample?.time ?? gpxTrack.startTime;
      if (t && forecastWindField && sliceWindField(forecastWindField, t)) {
        return null;
      }
      return range;
    }
    return null;
  }, [needWindField, mode, historyHours, gpxTrack, sessionSample, forecastWindField, forecastWindStatus]);

  useEffect(() => {
    if (!neededWindRange) {
      setRangeWindField(null);
      setRangeWindStatus("idle");
      return;
    }
    const key = `${neededWindRange.startDate}_${neededWindRange.endDate}`;
    const cached = rangeWindCacheRef.current.get(key);
    if (cached) {
      setRangeWindField(cached);
      setRangeWindStatus("ready");
      return;
    }
    let cancelled = false;
    setRangeWindStatus("loading");
    fetchAlbertaWindFieldRange(neededWindRange.startDate, neededWindRange.endDate)
      .then((field) => {
        if (cancelled) return;
        rangeWindCacheRef.current.set(key, field);
        setRangeWindField(field);
        setRangeWindStatus("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("Alberta wind field range failed", e);
        setRangeWindField(null);
        setRangeWindStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [neededWindRange]);

  const windSlice = useMemo(() => {
    if (!wind) return null;
    if (mode === "sim") return uniformWindSlice(wind);
    const nearest = (field: WindField | null) =>
      field && wind.time !== "sim"
        ? sliceWindField(field, wind.time, HRDPS_HANDOFF_MS)
        : null;
    const sliced =
      mode === "history"
        ? nearest(rangeWindField)
        : mode === "review"
          ? nearest(forecastWindField) ?? nearest(rangeWindField)
          : nearest(forecastWindField);
    return sliced;
  }, [mode, wind, forecastWindField, rangeWindField]);

  const windFieldStatus =
    mode === "sim"
      ? ("ready" as const)
      : mode === "history"
        ? rangeWindStatus === "idle"
          ? historyStatus === "loading"
            ? ("loading" as const)
            : historyStatus
          : rangeWindStatus
        : mode === "review" && rangeWindStatus !== "idle"
          ? rangeWindStatus
          : forecastWindStatus;

  const selectedHsM = useMemo(() => {
    if (mode === "review" && sessionSample) return sessionSample.hsM;
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
  }, [grids, wind, forecastPoint, sessionSample, mode]);

  const timeLabel = useMemo(() => {
    if (mode === "review" && sessionSample) {
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
  }, [wind, sessionSample, mode]);

  const wxHour =
    mode === "sim"
      ? null
      : mode === "review" && sessionSample
        ? sessionSample.wind
        : mode === "history"
          ? historyWind
          : forecastWind;

  const histMaxOffset = maxHistoryOffsetDays();
  const histLabel = historyViewLabel(historyOffsetDays);
  const rangeControlsDisabled = mode !== "forecast";
  const showForecastCharts =
    (mode === "forecast" || mode === "history") && chartHours.length > 0;
  const stravaLakes = useMemo(() => {
    if (!allShorelines) return [];
    const bounds = shorelineBoundsByLake(allShorelines);
    return lakes.flatMap((l) => {
      const b = bounds[l.id];
      if (!b) return [];
      return [{ id: l.id, name: l.name, bounds: b }];
    });
  }, [lakes, allShorelines]);
  const reviewWindTicks = useMemo(() => {
    if (mode !== "review" || !sessionSample) return null;
    return [
      {
        lon: sessionSample.lon,
        lat: sessionSample.lat,
        windDirDeg: sessionSample.wind.windDirDeg,
      },
    ];
  }, [mode, sessionSample]);

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
        {gpxError && <div className="banner error">{gpxError}</div>}
        {loading && <div className="banner">Loading lake & HRDPS wind…</div>}
        {sessionStatus === "loading" && mode === "review" && (
          <div className="banner">Loading HRDPS wind for session…</div>
        )}
        {historyStatus === "loading" && mode === "history" && (
          <div className="banner">Loading 90-day HRDPS history…</div>
        )}
        {historyStatus === "error" && mode === "history" && (
          <div className="banner error">Historical wind unavailable</div>
        )}
        {grids && spot && shoreline && (
          <MapView
            grids={grids}
            spot={spot}
            shoreline={shoreline}
            allShorelines={allShorelines}
            selectedLakeId={lakeId}
            onSelectLake={setLakeId}
            depthContours={depthContours}
            wind={wind}
            units={units}
            simulating={mode === "sim"}
            historic={mode === "history"}
            forecastPoint={forecastPoint}
            gpxTrack={mode === "review" ? gpxTrack : null}
            gpxCursor={
              mode === "review" && sessionSample
                ? {
                    lon: sessionSample.lon,
                    lat: sessionSample.lat,
                    headingDeg: sessionSample.headingDeg,
                  }
                : null
            }
            gpxWindTicks={reviewWindTicks}
            gpxWindTickIndex={reviewWindTicks ? 0 : null}
            followCursor={mode === "review" && reviewFollow}
            onFollowCursorChange={(on) => {
              setReviewFollow(on);
              saveReviewFollow(on);
            }}
            onChoosePoint={setForecastPoint}
            onClearPoint={() => setForecastPoint(null)}
            windSlice={windSlice}
            windFieldStatus={windFieldStatus}
            onOverlayChange={(id) =>
              setNeedWindField(id === "wind" || id === "waves")
            }
          />
        )}
        <WindSimPanel
          mode={mode}
          onModeChange={changeMode}
          speedMps={simSpeedMps}
          dirDeg={simDirDeg}
          onSpeedMps={setSimSpeedMps}
          onDirDeg={setSimDirDeg}
          windUnit={units.wind}
          historyStatus={historyStatus}
          historyOffsetDays={historyOffsetDays}
          historyLabel={histLabel}
          canHistoryBack={historyOffsetDays < histMaxOffset}
          canHistoryForward={historyOffsetDays > 0}
          onHistoryBack={() => {
            setHistoryOffsetDays((d) => Math.min(histMaxOffset, d + 7));
          }}
          onHistoryForward={() => {
            setHistoryOffsetDays((d) => Math.max(0, d - 7));
          }}
          reviewStatus={
            !gpxTrack ? "idle" : sessionStatus === "idle" ? "loading" : sessionStatus
          }
          reviewLabel={gpxTrack?.label ?? ""}
          reviewFollow={reviewFollow}
          onReviewFollowChange={(on) => {
            setReviewFollow(on);
            saveReviewFollow(on);
          }}
          reviewToolbar={
            <div className="review-sources">
              <input
                ref={gpxInputRef}
                type="file"
                accept=".gpx,application/gpx+xml,text/xml,application/xml"
                className="gpx-input"
                onChange={(e) => void onGpxPicked(e.target.files?.[0])}
              />
              <button
                type="button"
                className="gpx-btn"
                onClick={() => gpxInputRef.current?.click()}
              >
                Upload GPX
              </button>
              <StravaPanel
                embedded
                lakes={stravaLakes}
                activeTrackLabel={gpxTrack?.label ?? null}
                onTrack={onStravaTrack}
                onError={setGpxError}
              />
              {gpxTrack && (
                <button type="button" className="gpx-btn" onClick={clearGpx}>
                  Clear track
                </button>
              )}
            </div>
          }
        />
      </main>

      <footer className="bottombar">
        <div className="readout-row">
          <div className="readout">
            <strong>{spot?.identity.name ?? "—"}</strong>
            {mode === "sim" ? (
              <span className="sim-badge">Sim</span>
            ) : mode === "review" ? (
              <span className="review-badge">Review</span>
            ) : mode === "history" ? (
              <span className="history-badge">History</span>
            ) : (
              wind && <span className="muted">{timeLabel}</span>
            )}
            {(mode === "review" || mode === "sim" || mode === "history") &&
              wind && <span className="muted">{timeLabel}</span>}
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
                {mode === "review" && sessionSample
                  ? "Hs at you"
                  : forecastPoint
                    ? "Hs"
                    : "max Hs"}{" "}
                {formatWaveHeight(selectedHsM, units.wave)}
              </span>
            )}
            {reviewSpeedLabel && <span>Speed {reviewSpeedLabel}</span>}
            {reviewPointLabel && <span>{reviewPointLabel}</span>}
            {mode === "review" && gpxTrack && (
              <span className="muted" title={gpxTrack.filename}>
                Track {gpxTrack.label}
              </span>
            )}
            {mode === "forecast" && waterTempStatus === "loading" && (
              <span className="muted">water temp…</span>
            )}
            {mode === "forecast" && waterTempStatus === "ready" && waterTemp && (
              <span title={waterTemp.note}>
                Water {formatTemp(waterTemp.tempC, units.temp)}
                <span className="muted">
                  {" "}
                  MODIS {waterTemp.product === "LST_Night_1km" ? "night" : "day"}{" "}
                  {waterTemp.date}
                </span>
              </span>
            )}
            {mode === "forecast" && waterTempStatus === "unavailable" && (
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
              rangeControlsDisabled
                ? "Forecast range applies in Forecast mode"
                : "Forward forecast duration (always includes the past 24 hours)"
            }
          >
            {FORECAST_RANGE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={forecastRange === o.value ? "is-on" : ""}
                aria-pressed={forecastRange === o.value}
                disabled={rangeControlsDisabled}
                onClick={() => updateForecastRange(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        {reviewActive ? (
          <div className="forecast-panel">
            <CollapsiblePlot id="review-wind" title="Wind">
              <SessionWindChart
                samples={sessionSamples}
                sampleIndex={sessionIndex}
                onSelectSample={setSessionIndex}
                windUnit={units.wind}
              />
            </CollapsiblePlot>
            <CollapsiblePlot id="review-speed" title="Speed">
              <SessionSpeedChart
                samples={sessionSamples}
                sampleIndex={sessionIndex}
                onSelectSample={setSessionIndex}
                windUnit={units.wind}
              />
            </CollapsiblePlot>
            <CollapsiblePlot id="review-point" title="Point">
              <SessionPointChart
                samples={sessionSamples}
                sampleIndex={sessionIndex}
                onSelectSample={setSessionIndex}
              />
            </CollapsiblePlot>
            <CollapsiblePlot id="review-waves" title="Waves">
              <SessionWaveChart
                samples={sessionSamples}
                sampleIndex={sessionIndex}
                onSelectSample={setSessionIndex}
                waveUnit={units.wave}
              />
            </CollapsiblePlot>
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
          showForecastCharts && (
            <div className="forecast-panel">
              <CollapsiblePlot id="forecast-wind" title="Wind">
                <WindChart
                  hours={chartHours}
                  hourIndex={chartIndex}
                  onSelectHour={setChartIndex}
                  windUnit={units.wind}
                />
              </CollapsiblePlot>
              {grids && (
                <CollapsiblePlot id="forecast-waves" title="Waves">
                  <WaveChart
                    hours={chartHours}
                    hourIndex={chartIndex}
                    onSelectHour={setChartIndex}
                    grids={grids}
                    waveUnit={units.wave}
                    sampleAt={forecastPoint}
                  />
                </CollapsiblePlot>
              )}
              <CollapsiblePlot id="forecast-sky" title="Sky">
                <WeatherStrip
                  hours={chartHours}
                  hourIndex={chartIndex}
                  onSelectHour={setChartIndex}
                />
              </CollapsiblePlot>
              <div className="forecast-plot">
                <div className="forecast-plot-rail" aria-hidden />
                <ForecastTimeAxis
                  times={chartHours.map((h) => h.time)}
                  hourIndex={chartIndex}
                  onSelectHour={setChartIndex}
                />
              </div>
              <div className="forecast-plot scrubber-row">
                <div className="forecast-plot-rail scrubber-rail">
                  {mode === "history" ? (
                    <button
                      type="button"
                      className="now-btn"
                      disabled={historyOffsetDays === 0}
                      onClick={() => {
                        setHistoryOffsetDays(0);
                        if (history) {
                          setHistoryIndex(
                            nearestHourIndex(sliceHistoryView(history.hours, 0)),
                          );
                        }
                      }}
                    >
                      Latest
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="now-btn"
                      disabled={chartIndex === nearestHourIndex(chartHours)}
                      onClick={() =>
                        setChartIndex(nearestHourIndex(chartHours))
                      }
                    >
                      Now
                    </button>
                  )}
                </div>
                <div
                  className="scrubber"
                  style={sliderInsetStyle(chartHours.length)}
                >
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, chartHours.length - 1)}
                    value={chartIndex}
                    onChange={(e) => setChartIndex(Number(e.target.value))}
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
