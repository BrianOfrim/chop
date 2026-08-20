import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Topbar } from "./components/Topbar";
import { MapView, type OverlayId, type BasemapId, type WindGlyphId, loadBasemap, saveBasemap, loadWindGlyph, saveWindGlyph, loadOverlay, saveOverlay } from "./components/MapView";
import { WindChart } from "./components/WindChart";
import { TempChart, hasTempHours } from "./components/TempChart";
import { WaveChart, type ForecastPoint } from "./components/WaveChart";
import { ForecastTimeAxis } from "./components/ForecastTimeAxis";
import { RadarTimeline } from "./components/RadarTimeline";
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
  applyTempFieldToHours,
  fetchAlbertaTempField,
  sampleTempField,
  sliceTempField,
  type TempField,
} from "./lib/tempField";
import {
  fetchLakeSurfaceTemp,
  type LakeSurfaceTemp,
} from "./lib/lswt";
import {
  DEFAULT_UNITS,
  formatTemp,
  formatWaveHeight,
  loadUnitPrefs,
  saveUnitPrefs,
  type UnitPrefs,
} from "./lib/units";
import {
  approxMaxHs,
  approxMaxHsOverWind,
  computeHsGrid,
  hsAtLonLat,
  windDurationSec,
  type LakeGrids,
} from "@chop/wave-engine";
import { formatSelectedWhen, sliderInsetStyle } from "./lib/forecastChart";
import {
  fetchRadarWindows,
  loadRadar,
  RADAR_POLL_MS,
  radarTimeline,
  saveRadar,
  type RadarWindows,
} from "./lib/radar";
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
import { loadLakeId, saveLakeId } from "./lib/selectedLake";
import { isMobileViewport } from "./lib/mobile";
import {
  fetchAdvisories,
  lakeAdvisory,
  type AdvisoriesResponse,
} from "./lib/advisories";
import { LakeInfoPanel } from "./components/LakeInfoPanel";
import "./App.css";

const REVIEW_FOLLOW_KEY = "chop.reviewFollow";
const BOTTOM_PANEL_KEY = "chop.bottomPanelCollapsed";
const FORECAST_PINS_KEY = "chop.forecastPins";

const MAP_LAYERS = [
  ["wind", "Wind"],
  ["waves", "Waves"],
  ["temp", "Temp"],
  ["depth", "Depth"],
] as const;

type ForecastPins = Record<string, ForecastPoint>;

function isForecastPoint(value: unknown): value is ForecastPoint {
  if (!value || typeof value !== "object") return false;
  const pt = value as ForecastPoint;
  return Number.isFinite(pt.lon) && Number.isFinite(pt.lat);
}

function loadForecastPins(): ForecastPins {
  try {
    const raw = localStorage.getItem(FORECAST_PINS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ForecastPins = {};
    for (const [id, pt] of Object.entries(parsed as Record<string, unknown>)) {
      if (id && isForecastPoint(pt)) out[id] = { lon: pt.lon, lat: pt.lat };
    }
    return out;
  } catch {
    return {};
  }
}

function saveForecastPins(pins: ForecastPins): void {
  try {
    localStorage.setItem(FORECAST_PINS_KEY, JSON.stringify(pins));
  } catch {
    /* ignore */
  }
}

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

function loadBottomCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(BOTTOM_PANEL_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* ignore */
  }
  return isMobileViewport();
}

function saveBottomCollapsed(on: boolean): void {
  try {
    localStorage.setItem(BOTTOM_PANEL_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [lakes, setLakes] = useState<LakeIndexEntry[]>([]);
  const [lakeId, setLakeId] = useState(loadLakeId);
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
  const [advisories, setAdvisories] = useState<AdvisoriesResponse | null>(null);
  const [advisoriesStatus, setAdvisoriesStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [lakeInfoKind, setLakeInfoKind] = useState<"lake" | "advisory" | null>(
    null,
  );
  const [hourIndex, setHourIndex] = useState(0);
  const [forecastPins, setForecastPins] = useState<ForecastPins>(() =>
    typeof window !== "undefined" ? loadForecastPins() : {},
  );
  const forecastPoint = forecastPins[lakeId] ?? null;
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
  const [bottomCollapsed, setBottomCollapsed] = useState(loadBottomCollapsed);
  const [radarOn, setRadarOn] = useState(() =>
    typeof window !== "undefined" ? loadRadar() : false,
  );
  const [radarWindows, setRadarWindows] = useState<RadarWindows | null>(null);
  const [radarSelectedIso, setRadarSelectedIso] = useState<string | null>(null);
  const [radarFollowLive, setRadarFollowLive] = useState(true);
  const [basemap, setBasemap] = useState<BasemapId>(() =>
    typeof window !== "undefined" ? loadBasemap() : "topo",
  );
  const [windGlyph, setWindGlyph] = useState<WindGlyphId>(() =>
    typeof window !== "undefined" ? loadWindGlyph() : "particles",
  );
  const [overlay, setOverlay] = useState<OverlayId>(() =>
    typeof window !== "undefined" ? loadOverlay() : "wind",
  );
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
  const [needWindField, setNeedWindField] = useState(
    () => radarOn || overlay === "wind" || overlay === "waves",
  );
  const [needTempField, setNeedTempField] = useState(
    () => !radarOn && overlay === "temp",
  );
  const [forecastTempField, setForecastTempField] = useState<TempField | null>(
    null,
  );
  const [forecastTempStatus, setForecastTempStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");

  const onRadarChange = useCallback((on: boolean) => {
    setRadarOn(on);
    saveRadar(on);
    if (on) {
      setNeedWindField(true);
      setNeedTempField(false);
      setRadarFollowLive(true);
      setBottomCollapsed((prev) => {
        if (!prev) return prev;
        saveBottomCollapsed(false);
        return false;
      });
    }
  }, []);

  const onOverlayChange = useCallback((id: OverlayId) => {
    setOverlay(id);
    saveOverlay(id);
    setNeedWindField(id === "wind" || id === "waves");
    setNeedTempField(id === "temp");
    onRadarChange(false);
  }, [onRadarChange]);

  const onBasemapChange = useCallback((id: BasemapId) => {
    setBasemap(id);
    saveBasemap(id);
  }, []);

  const onWindGlyphChange = useCallback((id: WindGlyphId) => {
    setWindGlyph(id);
    saveWindGlyph(id);
  }, []);

  useEffect(() => {
    if (!radarOn) {
      setRadarWindows(null);
      return;
    }
    let cancelled = false;
    const sync = async () => {
      try {
        const windows = await fetchRadarWindows();
        if (cancelled) return;
        setRadarWindows(windows);
      } catch (err) {
        console.error("Radar time failed", err);
      }
    };
    void sync();
    const id = window.setInterval(() => void sync(), RADAR_POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [radarOn]);

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
    let cancelled = false;
    setAdvisoriesStatus("loading");
    fetchAdvisories()
      .then((data) => {
        if (cancelled) return;
        setAdvisories(data);
        setAdvisoriesStatus("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("AHS advisories failed", e);
        setAdvisories(null);
        setAdvisoriesStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setLakeInfoKind(null);
  }, [lakeId]);

  useEffect(() => {
    saveLakeId(lakeId);
  }, [lakeId]);

  useEffect(() => {
    if (lakes.length === 0) return;
    if (!lakes.some((l) => l.id === lakeId)) {
      setLakeId(lakes[0]!.id);
    }
  }, [lakes, lakeId]);

  const windFetchBlocked = forecastWindStatus === "error";
  useEffect(() => {
    if (forecastWindField || windFetchBlocked) return;
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
  }, [forecastWindField, windFetchBlocked]);

  useEffect(() => {
    if (forecastWindStatus !== "error") return;
    const id = window.setTimeout(() => setForecastWindStatus("idle"), 120_000);
    return () => window.clearTimeout(id);
  }, [forecastWindStatus]);

  const tempFetchBlocked = forecastTempStatus === "error";
  useEffect(() => {
    if (!needTempField || forecastTempField || tempFetchBlocked) return;
    let cancelled = false;
    setForecastTempStatus("loading");
    fetchAlbertaTempField()
      .then((field) => {
        if (cancelled) return;
        setForecastTempField(field);
        setForecastTempStatus("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("Alberta temp field failed", e);
        setForecastTempField(null);
        setForecastTempStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [needTempField, forecastTempField, tempFetchBlocked]);

  useEffect(() => {
    if (forecastTempStatus !== "error") return;
    const id = window.setTimeout(() => setForecastTempStatus("idle"), 120_000);
    return () => window.clearTimeout(id);
  }, [forecastTempStatus]);

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
    const withWind = applyHrdpsFieldToHours(
      sliced,
      forecastWindField,
      lakeWindAt.lon,
      lakeWindAt.lat,
    );
    return applyTempFieldToHours(
      withWind,
      forecastTempField,
      lakeWindAt.lon,
      lakeWindAt.lat,
    );
  }, [forecast, forecastRange, forecastWindField, forecastTempField, lakeWindAt]);

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
  const chartNowIndex = nearestHourIndex(chartHours);
  const chartSelectedTime = chartHours[chartIndex]?.time;

  const radarClock = useMemo(() => radarTimeline(radarWindows), [radarWindows]);
  const radarIndex = useMemo(() => {
    if (radarFollowLive || !radarSelectedIso) return radarClock.liveIndex;
    const i = radarClock.times.indexOf(radarSelectedIso);
    return i >= 0 ? i : radarClock.liveIndex;
  }, [radarFollowLive, radarSelectedIso, radarClock]);
  const radarTimeIso = radarClock.times[radarIndex] ?? null;

  const selectRadarIndex = useCallback(
    (index: number) => {
      const iso = radarClock.times[index] ?? null;
      const live = index === radarClock.liveIndex;
      setRadarSelectedIso((prev) => (prev === iso ? prev : iso));
      setRadarFollowLive((prev) => (prev === live ? prev : live));
    },
    [radarClock],
  );

  const forecastWind = forecastHours[hourIndex] ?? null;
  const historyWind = historyHours[historyIndex] ?? null;
  const radarSnappedHour = useMemo(() => {
    if (!radarOn || !radarTimeIso || forecastHours.length === 0) return null;
    const t = Date.parse(radarTimeIso);
    if (!Number.isFinite(t)) return null;
    return forecastHours[nearestHourIndex(forecastHours, t)] ?? null;
  }, [radarOn, radarTimeIso, forecastHours]);

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
      tempC: null,
    }),
    [simSpeedMps, simDirDeg],
  );

  const wind = useMemo(() => {
    if (mode === "sim") return simWind;
    const hour =
      radarOn && radarSnappedHour
        ? radarSnappedHour
        : mode === "review" && sessionSample
          ? sessionSample.wind
          : mode === "history"
            ? historyWind
            : forecastWind;
    if (!hour) return null;
    let next = hour;
    if (forecastPoint && forecastWindField && next.time !== "sim") {
      const slice = sliceWindField(
        forecastWindField,
        next.time,
        HRDPS_HANDOFF_MS,
      );
      if (slice) {
        const s = sampleWindField(
          slice,
          forecastPoint.lon,
          forecastPoint.lat,
        );
        if (s) {
          next = {
            ...next,
            windSpeedMps: s.speedMps,
            windDirDeg: s.dirDeg,
          };
        }
      }
    }
    if (forecastPoint && forecastTempField && next.time !== "sim") {
      const tSlice = sliceTempField(
        forecastTempField,
        next.time,
        HRDPS_HANDOFF_MS,
      );
      if (tSlice) {
        const tempC = sampleTempField(
          tSlice,
          forecastPoint.lon,
          forecastPoint.lat,
        );
        if (tempC != null) next = { ...next, tempC };
      }
    }
    return next;
  }, [
    mode,
    simWind,
    radarOn,
    radarSnappedHour,
    sessionSample,
    historyWind,
    forecastWind,
    forecastPoint,
    forecastWindField,
    forecastTempField,
  ]);

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
      const t0 = gpxTrack.startTime;
      const t1 = gpxTrack.endTime ?? gpxTrack.startTime;
      if (
        t0 &&
        forecastWindField &&
        sliceWindField(forecastWindField, t0) &&
        (!t1 || sliceWindField(forecastWindField, t1))
      ) {
        return null;
      }
      return range;
    }
    return null;
  }, [needWindField, mode, historyHours, gpxTrack, forecastWindField, forecastWindStatus]);

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
      radarOn || (mode !== "history" && mode !== "review")
        ? nearest(forecastWindField)
        : mode === "history"
          ? nearest(rangeWindField)
          : nearest(forecastWindField) ?? nearest(rangeWindField);
    return sliced;
  }, [mode, wind, forecastWindField, rangeWindField, radarOn]);

  const windFieldStatus =
    mode === "sim"
      ? ("ready" as const)
      : radarOn || mode === "forecast"
        ? forecastWindStatus
        : mode === "history"
          ? rangeWindStatus === "idle"
            ? historyStatus === "loading"
              ? ("loading" as const)
              : historyStatus
            : rangeWindStatus
          : mode === "review" && rangeWindStatus !== "idle"
            ? rangeWindStatus
            : forecastWindStatus;

  const tempSlice = useMemo(() => {
    if (mode === "sim" || !wind || wind.time === "sim" || !forecastTempField) {
      return null;
    }
    return sliceTempField(forecastTempField, wind.time, HRDPS_HANDOFF_MS);
  }, [mode, wind, forecastTempField]);

  const tempFieldStatus =
    mode === "sim"
      ? ("ready" as const)
      : !needTempField && forecastTempStatus === "idle"
        ? ("idle" as const)
        : forecastTempStatus;

  const waveDurationSec = useMemo(() => {
    if (mode === "sim") return undefined;
    if (mode === "review") {
      if (!sessionHours || !sessionSample) return undefined;
      return windDurationSec(sessionHours, sessionSample.hourIndex);
    }
    return windDurationSec(chartHours, chartIndex);
  }, [mode, chartHours, chartIndex, sessionHours, sessionSample]);

  const selectedHsM = useMemo(() => {
    if (mode === "review" && sessionSample) return sessionSample.hsM;
    if (!grids || !wind) return null;
    if (forecastPoint) {
      return hsAtLonLat(
        grids,
        forecastPoint.lon,
        forecastPoint.lat,
        wind.windSpeedMps,
        wind.windDirDeg,
        waveDurationSec,
      );
    }
    if (grids.waveStats && windSlice && !windSlice.uniform) {
      return approxMaxHsOverWind(
        grids.waveStats,
        windSlice,
        grids.meta,
        waveDurationSec,
      );
    }
    if (grids.waveStats) {
      return approxMaxHs(
        wind.windSpeedMps,
        wind.windDirDeg,
        grids.waveStats,
        waveDurationSec,
      );
    }
    const hs = computeHsGrid(
      grids,
      wind.windSpeedMps,
      wind.windDirDeg,
      waveDurationSec,
    );
    let m = 0;
    for (let i = 0; i < hs.length; i++) {
      const v = hs[i]!;
      if (Number.isFinite(v) && v > m) m = v;
    }
    return m;
  }, [grids, wind, windSlice, forecastPoint, sessionSample, mode, waveDurationSec]);

  const spatialWaveHs = useMemo(() => {
    if (!grids?.waveStats || forecastPoint || mode === "sim") return undefined;
    const field =
      mode === "history" ? rangeWindField : forecastWindField;
    if (!field) return undefined;
    return chartHours.map((h, i) => {
      const slice = sliceWindField(field, h.time, HRDPS_HANDOFF_MS);
      const durationSec = windDurationSec(chartHours, i);
      if (!slice || slice.uniform) {
        return approxMaxHs(
          h.windSpeedMps,
          h.windDirDeg,
          grids.waveStats!,
          durationSec,
        );
      }
      return approxMaxHsOverWind(
        grids.waveStats!,
        slice,
        grids.meta,
        durationSec,
      );
    });
  }, [
    grids,
    forecastPoint,
    mode,
    rangeWindField,
    forecastWindField,
    chartHours,
  ]);

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

  const selectedAdvisory = lakeAdvisory(advisories, lakeId);
  const closeLakeInfo = useCallback(() => setLakeInfoKind(null), []);
  const selectedLake = lakes.find((l) => l.id === lakeId);

  return (
    <div className="app">
      <Topbar
        view="map"
        units={units}
        onUnits={updateUnits}
        lakeId={lakeId}
        lakes={lakes}
        onLakeId={setLakeId}
        mode={mode}
        onModeChange={changeMode}
        basemap={basemap}
        onBasemapChange={onBasemapChange}
        windGlyph={windGlyph}
        onWindGlyphChange={onWindGlyphChange}
      />

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
            durationSec={waveDurationSec}
            units={units}
            simulating={mode === "sim"}
            historic={mode === "history"}
            clockMode={mode}
            selectedTime={
              radarOn
                ? radarTimeIso
                : mode === "sim"
                  ? null
                  : mode === "review" && sessionSample
                    ? sessionSample.time
                    : (chartSelectedTime ?? null)
            }
            radarFollowLive={radarOn && radarFollowLive}
            radarOn={radarOn}
            radarWindows={radarWindows}
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
            onChoosePoint={(point) => {
              setForecastPins((prev) => {
                const next = { ...prev, [lakeId]: point };
                saveForecastPins(next);
                return next;
              });
            }}
            onClearPoint={() => {
              setForecastPins((prev) => {
                if (!(lakeId in prev)) return prev;
                const next = { ...prev };
                delete next[lakeId];
                saveForecastPins(next);
                return next;
              });
            }}
            windSlice={windSlice}
            windFieldStatus={windFieldStatus}
            tempSlice={tempSlice}
            tempFieldStatus={tempFieldStatus}
            overlay={overlay}
            basemap={basemap}
            windGlyph={windGlyph}
          />
        )}
        <WindSimPanel
          mode={mode}
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

      <footer className={`bottombar${bottomCollapsed ? " is-collapsed" : ""}`}>
        <div className="readout-row">
          <button
            type="button"
            className="bottombar-fold"
            aria-expanded={!bottomCollapsed}
            aria-controls={radarOn ? "radar-timeline" : "bottom-charts"}
            title={
              bottomCollapsed
                ? radarOn
                  ? "Show radar timeline"
                  : "Show charts"
                : radarOn
                  ? "Hide radar timeline"
                  : "Hide charts"
            }
            onClick={() => {
              setBottomCollapsed((prev) => {
                const next = !prev;
                saveBottomCollapsed(next);
                return next;
              });
            }}
          >
            <span className="plot-fold-chevron" aria-hidden>
              {bottomCollapsed ? "▸" : "▾"}
            </span>
            {radarOn ? "Radar" : "Charts"}
          </button>
          <div className="readout">
            <div className="readout-primary">
            <div className="lake-info">
              <button
                type="button"
                className="lake-name-btn"
                aria-expanded={lakeInfoKind === "lake"}
                aria-haspopup="dialog"
                aria-controls="lake-info-panel"
                title="Lake info"
                onClick={() =>
                  setLakeInfoKind((kind) => (kind === "lake" ? null : "lake"))
                }
              >
                {selectedLake?.name ?? spot?.identity.name ?? "—"}
              </button>
              {selectedAdvisory?.advisory && (
                <button
                  type="button"
                  className="advisory-badge"
                  aria-expanded={lakeInfoKind === "advisory"}
                  aria-haspopup="dialog"
                  aria-controls="lake-advisory-panel"
                  title="Algae advisory"
                  onClick={() =>
                    setLakeInfoKind((kind) =>
                      kind === "advisory" ? null : "advisory",
                    )
                  }
                >
                  Algae advisory
                </button>
              )}
              {(advisoriesStatus === "error" ||
                advisories?.status === "unavailable") && (
                <button
                  type="button"
                  className="advisory-unknown"
                  aria-expanded={lakeInfoKind === "advisory"}
                  aria-haspopup="dialog"
                  aria-controls="lake-advisory-panel"
                  title="Advisory status unavailable"
                  onClick={() =>
                    setLakeInfoKind((kind) =>
                      kind === "advisory" ? null : "advisory",
                    )
                  }
                >
                  Check AHS
                </button>
              )}
              <LakeInfoPanel
                open={lakeInfoKind != null}
                kind={lakeInfoKind ?? "lake"}
                onClose={closeLakeInfo}
                lakeName={selectedLake?.name ?? spot?.identity.name ?? "—"}
                region={selectedLake?.region}
                summary={spot?.identity.summary}
                feed={advisories}
                feedStatus={advisoriesStatus}
                lake={selectedAdvisory}
              />
            </div>
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
            {selectedHsM != null && (
              <span>
                {mode === "review" && sessionSample
                  ? "At you"
                  : forecastPoint
                    ? "Wave height"
                    : "Lake max"}{" "}
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
            </div>
            <div className="readout-more">
            {wind?.tempC != null && Number.isFinite(wind.tempC) && (
              <span>{formatTemp(wind.tempC, units.temp)}</span>
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
          </div>
          <div className="bottombar-trailing">
          {!radarOn ? (
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
          ) : null}
          <div className="overlay-nav" role="group" aria-label="Map layer">
            {MAP_LAYERS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={!radarOn && overlay === id ? "is-on" : undefined}
                aria-pressed={!radarOn && overlay === id}
                onClick={() => onOverlayChange(id)}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={`overlay-nav-radar${radarOn ? " is-on" : ""}`}
              aria-pressed={radarOn}
              aria-controls="radar-timeline"
              title="Show weather radar"
              onClick={() => onRadarChange(true)}
            >
              Radar
            </button>
          </div>
          </div>
        </div>
        {!bottomCollapsed && (radarOn ? (
          <RadarTimeline
            windows={radarWindows}
            committedIndex={radarIndex}
            followLive={radarFollowLive}
            onCommitIndex={selectRadarIndex}
            shoreline={shoreline}
            pin={forecastPoint}
          />
        ) : reviewActive ? (
          <div id="bottom-charts" className="forecast-panel">
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
            <div id="bottom-charts" className="forecast-panel">
              <CollapsiblePlot id="forecast-wind" title="Wind">
                <WindChart
                  hours={chartHours}
                  hourIndex={chartIndex}
                  onSelectHour={setChartIndex}
                  windUnit={units.wind}
                />
              </CollapsiblePlot>
              {grids && spot?.spotId === lakeId && (
                <CollapsiblePlot id="forecast-waves" title="Waves">
                  <WaveChart
                    hours={chartHours}
                    hourIndex={chartIndex}
                    onSelectHour={setChartIndex}
                    grids={grids}
                    waveUnit={units.wave}
                    sampleAt={forecastPoint}
                    hsMSeries={spatialWaveHs}
                  />
                </CollapsiblePlot>
              )}
              {hasTempHours(chartHours) && (
                <CollapsiblePlot id="forecast-air" title="Temp">
                  <TempChart
                    hours={chartHours}
                    hourIndex={chartIndex}
                    onSelectHour={setChartIndex}
                    tempUnit={units.temp}
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
              <div className="forecast-plot compare-selected-time-row">
                <div className="forecast-plot-rail" aria-hidden />
                <p className="compare-selected-time" aria-live="polite">
                  {chartSelectedTime
                    ? formatSelectedWhen(chartSelectedTime)
                    : ""}
                  {mode !== "history" && chartIndex === chartNowIndex
                    ? " · Now"
                    : ""}
                </p>
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
                      disabled={chartIndex === chartNowIndex}
                      onClick={() => setChartIndex(chartNowIndex)}
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
                    aria-label="Forecast hour"
                    aria-valuetext={
                      chartSelectedTime
                        ? `${formatSelectedWhen(chartSelectedTime)}${
                            mode !== "history" && chartIndex === chartNowIndex
                              ? ", now"
                              : ""
                          }`
                        : undefined
                    }
                  />
                </div>
              </div>
            </div>
          )
        ))}
      </footer>
    </div>
  );
}
