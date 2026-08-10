export type WindHour = {
  time: string;
  windSpeedMps: number;
  windDirDeg: number;
  gustMps: number | null;
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
    wind_speed_10m?: number[];
    wind_direction_10m?: number[];
    wind_gusts_10m?: Array<number | null>;
  };
};

function parseGemHours(data: GemHourlyResponse): WindHour[] {
  const t: string[] = data.hourly?.time ?? [];
  const spd: number[] = data.hourly?.wind_speed_10m ?? [];
  const dir: number[] = data.hourly?.wind_direction_10m ?? [];
  const gust: Array<number | null> = data.hourly?.wind_gusts_10m ?? [];
  return t.map((time, i) => ({
    time,
    windSpeedMps: spd[i] ?? 0,
    windDirDeg: dir[i] ?? 0,
    gustMps: gust[i] ?? null,
  }));
}

/** Open-Meteo GEM HRDPS continental (~2.5 km) — upcoming forecast. */
export async function fetchHrdpsWind(
  lat: number,
  lon: number,
): Promise<WindForecast> {
  const url = new URL("https://api.open-meteo.com/v1/gem");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("hourly", "wind_speed_10m,wind_direction_10m,wind_gusts_10m");
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "2");
  url.searchParams.set("models", "gem_hrdps_continental");

  const res = await globalThis.fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo error ${res.status}`);
  const data = (await res.json()) as GemHourlyResponse;
  return { model: "gem_hrdps_continental", hours: parseGemHours(data) };
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
  const url = new URL("https://api.open-meteo.com/v1/gem");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("hourly", "wind_speed_10m,wind_direction_10m,wind_gusts_10m");
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("start_date", date);
  url.searchParams.set("end_date", date);
  url.searchParams.set("models", "gem_hrdps_continental");

  const res = await globalThis.fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo error ${res.status}`);
  const data = (await res.json()) as GemHourlyResponse;
  const hours = parseGemHours(data);
  if (hours.length === 0) {
    throw new Error(`No HRDPS hours returned for ${date}`);
  }
  return { model: "gem_hrdps_continental", hours, date };
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

export function formatWindKt(mps: number): string {
  return `${(mps * 1.94384).toFixed(0)} kt`;
}

export function formatWind(
  mps: number,
  fromDeg: number,
  gustMps?: number | null,
): string {
  const dirs = [
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
  const i = Math.round((((fromDeg % 360) + 360) % 360) / 22.5) % 16;
  const gust =
    gustMps != null && Number.isFinite(gustMps)
      ? ` G${(gustMps * 1.94384).toFixed(0)}`
      : "";
  return `${formatWindKt(mps)}${gust} from ${dirs[i]} (${fromDeg.toFixed(0)}°)`;
}

/** Compact label for the map wind arrow (mean + gust). */
export function formatWindMapLabel(
  mps: number,
  gustMps?: number | null,
): string {
  if (gustMps != null && Number.isFinite(gustMps)) {
    return `${formatWindKt(mps)} G${(gustMps * 1.94384).toFixed(0)}`;
  }
  return formatWindKt(mps);
}
