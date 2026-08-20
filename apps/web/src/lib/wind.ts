import type { WindSpeedUnit } from "./units";
import { formatWindSpeed, mpsToWind } from "./units";

export type WindHour = {
  time: string;
  windSpeedMps: number;
  windDirDeg: number;
  gustMps: number | null;
  weatherCode: number | null;
  precipMm: number;
  tempC: number | null;
};

export type WindForecast = {
  model: string;
  hours: WindHour[];
  /** ISO date when this is a historical pull (YYYY-MM-DD). */
  date?: string;
};

type GemHourlyResponse = {
  hourly?: {
    time?: string[];
    wind_speed_10m?: Array<number | null>;
    wind_direction_10m?: Array<number | null>;
    wind_gusts_10m?: Array<number | null>;
    weather_code?: Array<number | null>;
    precipitation?: Array<number | null>;
    temperature_2m?: Array<number | null>;
  };
  hours?: WindHour[];
  model?: string;
  date?: string;
};

function parseGemHours(data: GemHourlyResponse): WindHour[] {
  if (Array.isArray(data.hours) && data.hours.length > 0) {
    return data.hours.map((h) => ({
      ...h,
      precipMm: h.precipMm ?? 0,
      tempC: h.tempC != null && Number.isFinite(h.tempC) ? h.tempC : null,
    }));
  }
  const t: string[] = data.hourly?.time ?? [];
  const spd: Array<number | null> = data.hourly?.wind_speed_10m ?? [];
  const dir: Array<number | null> = data.hourly?.wind_direction_10m ?? [];
  const gust: Array<number | null> = data.hourly?.wind_gusts_10m ?? [];
  const code: Array<number | null> = data.hourly?.weather_code ?? [];
  const precip: Array<number | null> = data.hourly?.precipitation ?? [];
  const temp: Array<number | null> = data.hourly?.temperature_2m ?? [];
  const hours: WindHour[] = [];
  for (let i = 0; i < t.length; i++) {
    const windSpeedMps = spd[i];
    const windDirDeg = dir[i];
    if (windSpeedMps == null || windDirDeg == null) continue;
    const tempC = temp[i];
    hours.push({
      time: t[i]!,
      windSpeedMps,
      windDirDeg,
      gustMps: gust[i] ?? null,
      weatherCode: code[i] ?? null,
      precipMm: precip[i] ?? 0,
      tempC: tempC != null && Number.isFinite(tempC) ? tempC : null,
    });
  }
  return hours;
}

async function fetchWindJson(url: string): Promise<GemHourlyResponse> {
  const res = await globalThis.fetch(url);
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) detail = `: ${body.error}`;
    } catch {
      // ignore
    }
    throw new Error(`Wind error ${res.status}${detail}`);
  }
  return (await res.json()) as GemHourlyResponse;
}

/** GEM seamless 7-day timeline; HRDPS field overwrites speed/dir for ~48 h. */
export async function fetchHrdpsWind(
  lat: number,
  lon: number,
): Promise<WindForecast> {
  const q = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  const data = await fetchWindJson(`/api/wind/point?${q}`);
  return {
    model: data.model ?? "gem_seamless",
    hours: parseGemHours(data),
  };
}

/**
 * Historical HRDPS via the Chop API cache (Open-Meteo Historical Forecast).
 * The live `/v1/gem` endpoint only keeps ~2 months of HRDPS.
 */
export async function fetchHrdpsWindRange(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
): Promise<WindForecast> {
  const q = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    start: startDate,
    end: endDate,
  });
  const data = await fetchWindJson(`/api/wind/point?${q}`);
  const hours = parseGemHours(data);
  if (hours.length === 0) {
    throw new Error(`No HRDPS hours returned for ${startDate}–${endDate}`);
  }
  return {
    model: data.model ?? "gem_hrdps_continental",
    hours,
    date: data.date ?? (startDate === endDate ? startDate : `${startDate}/${endDate}`),
  };
}

/**
 * Historical / past-day HRDPS via Open-Meteo GEM (start_date / end_date).
 * @param date ISO calendar day, e.g. "2026-08-02"
 */
export async function fetchHrdpsWindForDate(
  lat: number,
  lon: number,
  date: string,
): Promise<WindForecast> {
  return fetchHrdpsWindRange(lat, lon, date, date);
}

/** Hour closest to `atMs` (default now). */
export function nearestHourIndex(
  hours: Array<{ time: string }>,
  atMs: number = Date.now(),
): number {
  let best = 0;
  let bestDiff = Infinity;
  hours.forEach((h, i) => {
    const d = Math.abs(new Date(h.time).getTime() - atMs);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  });
  return best;
}

/** Index of the strongest wind hour (for a useful default scrubber position). */
export function strongestWindHourIndex(hours: WindHour[]): number {
  let best = 0;
  let bestSpd = -1;
  hours.forEach((h, i) => {
    if (h.windSpeedMps > bestSpd) {
      bestSpd = h.windSpeedMps;
      best = i;
    }
  });
  return best;
}

const DIRS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];

export function cardinalFromDeg(fromDeg: number): string {
  const i = Math.round((((fromDeg % 360) + 360) % 360) / 22.5) % 16;
  return DIRS[i]!;
}

export function formatWind(
  mps: number,
  fromDeg: number,
  gustMps?: number | null,
  unit: WindSpeedUnit = "kt",
): string {
  const digits = unit === "mps" ? 1 : 0;
  const gust =
    gustMps != null && Number.isFinite(gustMps)
      ? ` G${mpsToWind(gustMps, unit).toFixed(digits)}`
      : "";
  return `${formatWindSpeed(mps, unit)}${gust} from ${cardinalFromDeg(fromDeg)} (${fromDeg.toFixed(0)}°)`;
}
