/** Environment Canada GeoMet weather radar (WMS). */

const GEOMET = "https://geo.weather.gc.ca/geomet";

export const RADAR_RAIN_SOURCE = "radar-rain";
export const RADAR_SNOW_SOURCE = "radar-snow";

export type RadarWmsLayer = {
  sourceId: string;
  wmsLayer: string;
};

export const RADAR_OBS_LAYERS: readonly RadarWmsLayer[] = [
  { sourceId: RADAR_SNOW_SOURCE, wmsLayer: "RADAR_1KM_RSNO" },
  { sourceId: RADAR_RAIN_SOURCE, wmsLayer: "RADAR_1KM_RRAI" },
];

export const RADAR_NOWCAST_LAYERS: readonly RadarWmsLayer[] = [
  {
    sourceId: RADAR_SNOW_SOURCE,
    wmsLayer: "Radar_1km_SnowPrecipRate-Extrapolation",
  },
  {
    sourceId: RADAR_RAIN_SOURCE,
    wmsLayer: "Radar_1km_RainPrecipRate-Extrapolation",
  },
];

export const RADAR_ATTRIBUTION =
  'Radar &copy; <a href="https://eccc-msc.github.io/open-data/licence/readme_en/">Environment and Climate Change Canada</a>';

/** Poll while the layer is on; GeoMet publishes a new frame every 6 minutes. */
export const RADAR_POLL_MS = 2 * 60 * 1000;

export const RADAR_STORAGE_KEY = "chop.radar";

export function loadRadar(): boolean {
  try {
    return localStorage.getItem(RADAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveRadar(on: boolean): void {
  try {
    localStorage.setItem(RADAR_STORAGE_KEY, on ? "1" : "0");
  } catch {
    // ignore quota / private mode
  }
}

const OBS_CAP_LAYER = "RADAR_1KM_RRAI";
const NOWCAST_CAP_LAYER = "Radar_1km_RainPrecipRate-Extrapolation";

export type RadarKind = "observed" | "nowcast" | "none";

export type RadarTimeWindow = {
  startMs: number;
  endMs: number;
  defaultIso: string | null;
  times: string[];
};

export type RadarWindows = {
  observed: RadarTimeWindow;
  nowcast: RadarTimeWindow | null;
};

export type RadarFrame = {
  kind: RadarKind;
  timeIso: string | null;
  layers: readonly RadarWmsLayer[];
};

/** GeoMet default rain/snow 14-color styles (sampled from GetLegendGraphic). */
export const RADAR_STYLE_RAIN = "Radar-Rain_14colors";
export const RADAR_STYLE_SNOW = "Radar-Snow_14colors";

/**
 * ECCC Radar-Rain_14colors stops, low → high.
 * Rates (mm/h rain, cm/h snow) sit at equal positions on the official legend.
 */
export const RADAR_LEGEND_STOPS: readonly {
  rate: number;
  rgb: readonly [number, number, number];
}[] = [
  { rate: 0.1, rgb: [25, 161, 254] },
  { rate: 1, rgb: [0, 229, 140] },
  { rate: 2, rgb: [0, 220, 34] },
  { rate: 4, rgb: [0, 157, 0] },
  { rate: 8, rgb: [0, 104, 0] },
  { rate: 12, rgb: [254, 254, 0] },
  { rate: 16, rgb: [254, 203, 0] },
  { rate: 24, rgb: [254, 152, 0] },
  { rate: 32, rgb: [254, 102, 0] },
  { rate: 50, rgb: [254, 0, 0] },
  { rate: 64, rgb: [254, 2, 152] },
  { rate: 100, rgb: [152, 51, 203] },
  { rate: 125, rgb: [102, 0, 152] },
  { rate: 200, rgb: [51, 0, 77] },
];

export const RADAR_LEGEND_TICK_RATES = [0.1, 4, 16, 64, 200] as const;

export function radarLegendGradientCss(): string {
  const last = RADAR_LEGEND_STOPS.length - 1;
  const parts = RADAR_LEGEND_STOPS.map((stop, i) => {
    const [r, g, b] = stop.rgb;
    const pct = last <= 0 ? 0 : (i / last) * 100;
    return `rgb(${r}, ${g}, ${b}) ${pct.toFixed(1)}%`;
  });
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

export function sampleRadarLegend(tRaw: number): {
  rate: number;
  rgb: [number, number, number];
} {
  const t = Math.max(0, Math.min(1, tRaw));
  const last = RADAR_LEGEND_STOPS.length - 1;
  const x = t * last;
  const i = Math.min(last - 1, Math.floor(x));
  const u = x - i;
  const a = RADAR_LEGEND_STOPS[i]!;
  const b = RADAR_LEGEND_STOPS[i + 1]!;
  return {
    rate: a.rate + (b.rate - a.rate) * u,
    rgb: [
      Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * u),
      Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * u),
      Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * u),
    ],
  };
}

export function formatRadarTick(rate: number): string {
  return rate < 1 ? rate.toFixed(1) : String(rate);
}

export function formatRadarRate(rate: number): string {
  const n = rate < 10 ? Math.round(rate * 10) / 10 : Math.round(rate);
  const label = n < 1 || !Number.isInteger(n) ? n.toFixed(1) : String(n);
  return `${label} mm/h`;
}

function radarStyleForLayer(wmsLayer: string): string {
  return /snow|rsno/i.test(wmsLayer) ? RADAR_STYLE_SNOW : RADAR_STYLE_RAIN;
}

export function radarTileUrl(
  wmsLayer: string,
  timeIso?: string | null,
): string {
  // Keep `{bbox-epsg-3857}` literal — MapLibre substitutes it per tile.
  const style = radarStyleForLayer(wmsLayer);
  let url =
    `${GEOMET}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap` +
    `&LAYERS=${encodeURIComponent(wmsLayer)}` +
    `&STYLES=${encodeURIComponent(style)}` +
    `&CRS=EPSG:3857&BBOX={bbox-epsg-3857}` +
    `&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE`;
  if (timeIso) url += `&TIME=${encodeURIComponent(timeIso)}`;
  return url;
}

export function parseIsoDurationMs(spec: string): number | null {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(spec.trim());
  if (!m) return null;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  const ms = ((h * 60 + min) * 60 + s) * 1000;
  return ms > 0 ? ms : null;
}

export function expandRadarTimes(spec: string): string[] {
  const trimmed = spec.trim();
  if (!trimmed) return [];
  if (trimmed.includes(",")) {
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const parts = trimmed.split("/");
  if (parts.length === 1) return [parts[0]!.trim()].filter(Boolean);
  if (parts.length !== 3) {
    return parts.map((s) => s.trim()).filter(Boolean);
  }
  const start = Date.parse(parts[0]!);
  const end = Date.parse(parts[1]!);
  const step = parseIsoDurationMs(parts[2]!);
  if (!Number.isFinite(start) || !Number.isFinite(end) || step == null) {
    return [];
  }
  const out: string[] = [];
  for (let t = start; t <= end + 1; t += step) {
    out.push(new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z"));
  }
  return out;
}

export function parseRadarDimension(xml: string): RadarTimeWindow | null {
  const tag = /<Dimension\s+name="time"[^>]*>/i.exec(xml)?.[0];
  if (!tag) return null;
  const defaultIso = /\bdefault="([^"]+)"/i.exec(tag)?.[1] ?? null;
  const body = /<Dimension\s+name="time"[^>]*>([^<]*)<\/Dimension>/i.exec(
    xml,
  )?.[1];
  const times = body ? expandRadarTimes(body) : [];
  if (defaultIso && !times.includes(defaultIso)) times.push(defaultIso);
  if (times.length === 0) return null;
  const ms = times
    .map((iso) => Date.parse(iso))
    .filter((t) => Number.isFinite(t));
  if (ms.length === 0) return null;
  return {
    startMs: Math.min(...ms),
    endMs: Math.max(...ms),
    defaultIso,
    times,
  };
}

/** Latest TIME from a GetCapabilities document (observed default / range end). */
export function parseRadarTime(xml: string): string | null {
  const win = parseRadarDimension(xml);
  return win?.defaultIso ?? win?.times[win.times.length - 1] ?? null;
}

async function fetchRadarDimension(
  layerId: string,
): Promise<RadarTimeWindow | null> {
  const url = `${GEOMET}?service=WMS&version=1.3.0&request=GetCapabilities&layer=${encodeURIComponent(layerId)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Radar capabilities ${res.status}`);
  return parseRadarDimension(await res.text());
}

export async function fetchRadarWindows(): Promise<RadarWindows> {
  const [observed, nowcast] = await Promise.all([
    fetchRadarDimension(OBS_CAP_LAYER),
    fetchRadarDimension(NOWCAST_CAP_LAYER).catch(() => null),
  ]);
  if (!observed) throw new Error("Radar observed time dimension missing");
  return { observed, nowcast };
}

export function nearestRadarTime(
  times: string[],
  selectedMs: number,
): string | null {
  let best: string | null = null;
  let bestDiff = Infinity;
  for (const iso of times) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) continue;
    const d = Math.abs(t - selectedMs);
    if (d < bestDiff) {
      bestDiff = d;
      best = iso;
    }
  }
  return best;
}

const NONE_FRAME: RadarFrame = {
  kind: "none",
  timeIso: null,
  layers: RADAR_OBS_LAYERS,
};

/**
 * Map Chop's selected clock onto a GeoMet 6-minute frame.
 * `followLive` (forecast "Now") always uses the latest observed composite.
 */
export function resolveRadarFrame(
  selectedMs: number | null,
  windows: RadarWindows | null,
  followLive = false,
): RadarFrame {
  if (!windows) return NONE_FRAME;
  const { observed, nowcast } = windows;
  if (followLive) {
    const timeIso =
      observed.defaultIso ??
      observed.times[observed.times.length - 1] ??
      null;
    return { kind: "observed", timeIso, layers: RADAR_OBS_LAYERS };
  }
  if (selectedMs == null || !Number.isFinite(selectedMs)) return NONE_FRAME;
  if (selectedMs >= observed.startMs && selectedMs <= observed.endMs) {
    return {
      kind: "observed",
      timeIso: nearestRadarTime(observed.times, selectedMs),
      layers: RADAR_OBS_LAYERS,
    };
  }
  if (
    nowcast &&
    selectedMs > observed.endMs &&
    selectedMs >= nowcast.startMs &&
    selectedMs <= nowcast.endMs
  ) {
    return {
      kind: "nowcast",
      timeIso: nearestRadarTime(nowcast.times, selectedMs),
      layers: RADAR_NOWCAST_LAYERS,
    };
  }
  return NONE_FRAME;
}

export function formatRadarWhen(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatRadarLegend(frame: RadarFrame): string | null {
  if (frame.kind === "none") return "No radar this hour";
  if (!frame.timeIso) return "No radar this hour";
  const when = formatRadarWhen(frame.timeIso);
  return frame.kind === "nowcast"
    ? `Radar nowcast ${when}`
    : `Radar observed ${when}`;
}

export type RadarTimeline = {
  times: string[];
  liveIndex: number;
};

/**
 * Ordered unique 6-min frames: observed archive, then nowcast times
 * strictly after the latest observation.
 */
export function radarTimeline(windows: RadarWindows | null): RadarTimeline {
  if (!windows) return { times: [], liveIndex: 0 };
  const seen = new Set<string>();
  const times: string[] = [];
  const push = (iso: string) => {
    if (seen.has(iso)) return;
    seen.add(iso);
    times.push(iso);
  };
  for (const iso of windows.observed.times) push(iso);
  if (windows.nowcast) {
    for (const iso of windows.nowcast.times) {
      const t = Date.parse(iso);
      if (Number.isFinite(t) && t > windows.observed.endMs) push(iso);
    }
  }
  times.sort((a, b) => Date.parse(a) - Date.parse(b));
  const liveIso =
    windows.observed.defaultIso ??
    windows.observed.times[windows.observed.times.length - 1] ??
    null;
  let liveIndex = liveIso ? times.indexOf(liveIso) : -1;
  if (liveIndex < 0) {
    liveIndex = 0;
    for (let i = 0; i < times.length; i++) {
      if (Date.parse(times[i]!) <= windows.observed.endMs) liveIndex = i;
    }
  }
  return { times, liveIndex };
}
