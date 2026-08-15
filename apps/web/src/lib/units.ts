export type WindSpeedUnit = "kt" | "mps" | "mph" | "kmh";
export type WaveHeightUnit = "cm" | "m" | "ft";
export type TempUnit = "C" | "F";

export type UnitPrefs = {
  wind: WindSpeedUnit;
  wave: WaveHeightUnit;
  temp: TempUnit;
};

export const DEFAULT_UNITS: UnitPrefs = {
  wind: "kt",
  wave: "cm",
  temp: "C",
};

const STORAGE_KEY = "chop.units";

export const WIND_UNIT_OPTIONS: Array<{ value: WindSpeedUnit; label: string }> = [
  { value: "kt", label: "kt" },
  { value: "mps", label: "m/s" },
  { value: "mph", label: "mph" },
  { value: "kmh", label: "km/h" },
];

export const WAVE_UNIT_OPTIONS: Array<{ value: WaveHeightUnit; label: string }> =
  [
    { value: "cm", label: "cm" },
    { value: "m", label: "m" },
    { value: "ft", label: "ft" },
  ];

export const TEMP_UNIT_OPTIONS: Array<{ value: TempUnit; label: string }> = [
  { value: "C", label: "°C" },
  { value: "F", label: "°F" },
];

export function loadUnitPrefs(): UnitPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_UNITS };
    const parsed = JSON.parse(raw) as Partial<UnitPrefs>;
    return {
      wind: WIND_UNIT_OPTIONS.some((o) => o.value === parsed.wind)
        ? (parsed.wind as WindSpeedUnit)
        : DEFAULT_UNITS.wind,
      wave: WAVE_UNIT_OPTIONS.some((o) => o.value === parsed.wave)
        ? (parsed.wave as WaveHeightUnit)
        : DEFAULT_UNITS.wave,
      temp: TEMP_UNIT_OPTIONS.some((o) => o.value === parsed.temp)
        ? (parsed.temp as TempUnit)
        : DEFAULT_UNITS.temp,
    };
  } catch {
    return { ...DEFAULT_UNITS };
  }
}

export function saveUnitPrefs(prefs: UnitPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore quota / private mode
  }
}

export function mpsToWind(mps: number, unit: WindSpeedUnit): number {
  switch (unit) {
    case "kt":
      return mps * 1.94384;
    case "mph":
      return mps * 2.23694;
    case "kmh":
      return mps * 3.6;
    default:
      return mps;
  }
}

export function windToMps(value: number, unit: WindSpeedUnit): number {
  switch (unit) {
    case "kt":
      return value / 1.94384;
    case "mph":
      return value / 2.23694;
    case "kmh":
      return value / 3.6;
    default:
      return value;
  }
}

export function windUnitLabel(unit: WindSpeedUnit): string {
  return WIND_UNIT_OPTIONS.find((o) => o.value === unit)?.label ?? unit;
}

export function metersToWave(m: number, unit: WaveHeightUnit): number {
  switch (unit) {
    case "cm":
      return m * 100;
    case "ft":
      return m * 3.28084;
    default:
      return m;
  }
}

export function waveUnitLabel(unit: WaveHeightUnit): string {
  return WAVE_UNIT_OPTIONS.find((o) => o.value === unit)?.label ?? unit;
}

export function celsiusToTemp(c: number, unit: TempUnit): number {
  return unit === "F" ? (c * 9) / 5 + 32 : c;
}

export function tempUnitLabel(unit: TempUnit): string {
  return unit === "F" ? "°F" : "°C";
}

/** Nice axis ceiling for wind in the active unit. */
export function niceWindMax(maxVal: number, unit: WindSpeedUnit): number {
  const step = unit === "mps" ? 2 : 5;
  return Math.max(step * 2, Math.ceil(maxVal / step) * step);
}

/** Nice axis ceiling for wave height in the active unit. */
export function niceWaveMax(maxVal: number, unit: WaveHeightUnit): number {
  const step = unit === "m" ? 0.1 : unit === "ft" ? 0.5 : 10;
  const minCeil = unit === "m" ? 0.2 : unit === "ft" ? 1 : 20;
  return Math.max(minCeil, Math.ceil(maxVal / step) * step);
}

export function formatWaveHeight(m: number, unit: WaveHeightUnit): string {
  const v = metersToWave(m, unit);
  if (unit === "m") return `${v.toFixed(2)} m`;
  if (unit === "ft") return `${v.toFixed(1)} ft`;
  return `${v.toFixed(0)} cm`;
}

export function formatDepth(m: number, unit: WaveHeightUnit): string {
  if (unit === "ft") return `${(m * 3.28084).toFixed(1)} ft`;
  return `${m.toFixed(1)} m`;
}

export function formatTemp(c: number, unit: TempUnit): string {
  return `${celsiusToTemp(c, unit).toFixed(1)} ${tempUnitLabel(unit)}`;
}

export function formatWindSpeed(mps: number, unit: WindSpeedUnit): string {
  const v = mpsToWind(mps, unit);
  const digits = unit === "mps" ? 1 : 0;
  return `${v.toFixed(digits)} ${windUnitLabel(unit)}`;
}
