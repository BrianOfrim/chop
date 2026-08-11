/** WMO weather interpretation codes from Open-Meteo `weather_code`. */

export type WeatherKind =
  | "clear"
  | "partly"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunder";

export function isThunder(code: number | null | undefined): boolean {
  return code === 95 || code === 96 || code === 99;
}

export function weatherKind(code: number | null | undefined): WeatherKind {
  if (code == null || !Number.isFinite(code)) return "clear";
  if (isThunder(code)) return "thunder";
  if (code === 0 || code === 1) return "clear";
  if (code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  return "cloudy";
}

/**
 * Night vs day for icons. Uses the hour in Open-Meteo local timestamps
 * (`timezone=auto`, e.g. `2026-08-11T22:00`).
 */
export function isNightLocalTime(isoLocal: string): boolean {
  const m = /T(\d{2})/.exec(isoLocal);
  const hour = m ? Number(m[1]) : new Date(isoLocal).getHours();
  if (!Number.isFinite(hour)) return false;
  return hour < 6 || hour >= 20;
}

export function weatherLabel(code: number | null | undefined): string {
  switch (code) {
    case 0:
      return "Clear";
    case 1:
      return "Mainly clear";
    case 2:
      return "Partly cloudy";
    case 3:
      return "Overcast";
    case 45:
      return "Fog";
    case 48:
      return "Rime fog";
    case 51:
      return "Light drizzle";
    case 53:
      return "Drizzle";
    case 55:
      return "Dense drizzle";
    case 56:
      return "Light freezing drizzle";
    case 57:
      return "Freezing drizzle";
    case 61:
      return "Light rain";
    case 63:
      return "Rain";
    case 65:
      return "Heavy rain";
    case 66:
      return "Light freezing rain";
    case 67:
      return "Freezing rain";
    case 71:
      return "Light snow";
    case 73:
      return "Snow";
    case 75:
      return "Heavy snow";
    case 77:
      return "Snow grains";
    case 80:
      return "Light showers";
    case 81:
      return "Showers";
    case 82:
      return "Heavy showers";
    case 85:
      return "Light snow showers";
    case 86:
      return "Snow showers";
    case 95:
      return "Thunderstorm";
    case 96:
      return "Thunderstorm, hail";
    case 99:
      return "Thunderstorm, heavy hail";
    default:
      return "—";
  }
}

export function formatPrecipMm(mm: number): string {
  if (!Number.isFinite(mm) || mm < 0.05) return "";
  if (mm < 10) return `${mm.toFixed(1)} mm`;
  return `${Math.round(mm)} mm`;
}

export function formatPrecipShort(mm: number): string {
  if (!Number.isFinite(mm) || mm < 0.05) return "";
  if (mm < 10) return mm.toFixed(1);
  return String(Math.round(mm));
}

export function formatWeatherHour(
  code: number | null | undefined,
  precipMm: number,
): string {
  const label = weatherLabel(code);
  const precip = formatPrecipMm(precipMm);
  if (label === "—") return precip || "—";
  return precip ? `${label} · ${precip}` : label;
}
