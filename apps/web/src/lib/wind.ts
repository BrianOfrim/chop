import type { WindSpeedUnit } from "./units";
import { formatWindSpeed, mpsToWind, windUnitLabel } from "./units";

export type WindHour = {
  time: string;
  windSpeedMps: number;
  windDirDeg: number;
  gustMps: number | null;
  weatherCode: number | null;
  precipMm: number;
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
  };
};

const GEM_HOURLY =
  "wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,precipitation";

/** Open-Meteo historical-forecast host (full HRDPS archive, not the ~2 month live GEM cache). */
const HISTORICAL_FORECAST_URL =
  "https://historical-forecast-api.open-meteo.com/v1/forecast";

function parseGemHours(data: GemHourlyResponse): WindHour[] {
  const t: string[] = data.hourly?.time ?? [];
  const spd: Array<number | null> = data.hourly?.wind_speed_10m ?? [];
  const dir: Array<number | null> = data.hourly?.wind_direction_10m ?? [];
  const gust: Array<number | null> = data.hourly?.wind_gusts_10m ?? [];
  const code: Array<number | null> = data.hourly?.weather_code ?? [];
  const precip: Array<number | null> = data.hourly?.precipitation ?? [];
  const hours: WindHour[] = [];
  for (let i = 0; i < t.length; i++) {
    const windSpeedMps = spd[i];
    const windDirDeg = dir[i];
    if (windSpeedMps == null || windDirDeg == null) continue;
    hours.push({
      time: t[i]!,
      windSpeedMps,
      windDirDeg,
      gustMps: gust[i] ?? null,
      weatherCode: code[i] ?? null,
      precipMm: precip[i] ?? 0,
    });
  }
  return hours;
}

/** GEM blend: HRDPS (~2.5 km) for ~48 h, then RDPS / global out to 7 days. */
export async function fetchHrdpsWind(
  lat: number,
  lon: number,
): Promise<WindForecast> {
  const url = new URL("https://api.open-meteo.com/v1/gem");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("hourly", GEM_HOURLY);
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "7");
  url.searchParams.set("past_days", "1");
  url.searchParams.set("models", "gem_seamless");

  const res = await globalThis.fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo error ${res.status}`);
  const data = (await res.json()) as GemHourlyResponse;
  return { model: "gem_seamless", hours: parseGemHours(data) };
}

/**
 * Historical HRDPS via Open-Meteo Historical Forecast API for an inclusive
 * calendar range (`YYYY-MM-DD`, interpreted with `timezone=auto`).
 * The live `/v1/gem` endpoint only keeps ~2 months of HRDPS.
 */
export async function fetchHrdpsWindRange(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
): Promise<WindForecast> {
  const url = new URL(HISTORICAL_FORECAST_URL);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("hourly", GEM_HOURLY);
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("models", "gem_hrdps_continental");

  const res = await globalThis.fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo error ${res.status}`);
  const data = (await res.json()) as GemHourlyResponse;
  const hours = parseGemHours(data);
  if (hours.length === 0) {
    throw new Error(`No HRDPS hours returned for ${startDate}–${endDate}`);
  }
  return {
    model: "gem_hrdps_continental",
    hours,
    date: startDate === endDate ? startDate : `${startDate}/${endDate}`,
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
  hours: WindHour[],
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

/** Compact label for the map wind arrow (mean + gust). */
export function formatWindMapLabel(
  mps: number,
  gustMps?: number | null,
  unit: WindSpeedUnit = "kt",
): string {
  const digits = unit === "mps" ? 1 : 0;
  const mean = `${mpsToWind(mps, unit).toFixed(digits)} ${windUnitLabel(unit)}`;
  if (gustMps != null && Number.isFinite(gustMps)) {
    return `${mean} G${mpsToWind(gustMps, unit).toFixed(digits)}`;
  }
  return mean;
}
