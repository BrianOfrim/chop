/** How many hours of forecast to show in the charts. */

export type ForecastRangeHours = 72 | 168;

/** Always include this many hours before now in the visible window. */
export const FORECAST_LOOKBACK_HOURS = 24;

export const FORECAST_RANGE_OPTIONS: Array<{
  value: ForecastRangeHours;
  label: string;
}> = [
  { value: 72, label: "72 h" },
  { value: 168, label: "7 d" },
];

export const DEFAULT_FORECAST_RANGE: ForecastRangeHours = 72;

const STORAGE_KEY = "chop.forecastRange";

export function loadForecastRange(): ForecastRangeHours {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = Number(raw);
    if (n === 72 || n === 168) return n;
  } catch {
    // ignore
  }
  return DEFAULT_FORECAST_RANGE;
}

export function saveForecastRange(hours: ForecastRangeHours): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(hours));
  } catch {
    // ignore quota / private mode
  }
}

type Timed = { time: string };

/**
 * Visible window: the preceding 24 hours through `rangeHours` of lead time
 * from `now` (inclusive of hours that fall in that span).
 */
export function sliceForecastHours<T extends Timed>(
  hours: T[],
  rangeHours: ForecastRangeHours,
  nowMs: number = Date.now(),
): T[] {
  if (hours.length === 0) return hours;
  const tStart = nowMs - FORECAST_LOOKBACK_HOURS * 3600 * 1000;
  const tEnd = nowMs + rangeHours * 3600 * 1000;
  const out = hours.filter((h) => {
    const t = Date.parse(h.time);
    return Number.isFinite(t) && t >= tStart && t <= tEnd;
  });
  if (out.length > 0) return out;

  // Fallback if the series doesn't cover "now" (clock skew / empty past).
  let start = 0;
  let best = Infinity;
  hours.forEach((h, i) => {
    const d = Math.abs(Date.parse(h.time) - nowMs);
    if (d < best) {
      best = d;
      start = i;
    }
  });
  return hours.slice(start, start + Math.max(1, rangeHours));
}

/** Keep selection on the same timestamp when the visible window changes. */
export function remapHourIndex(
  prevHours: Timed[],
  prevIndex: number,
  nextHours: Timed[],
  nowMs: number = Date.now(),
): number {
  if (nextHours.length === 0) return 0;
  const prev = prevHours[prevIndex];
  if (prev) {
    const target = Date.parse(prev.time);
    if (Number.isFinite(target)) {
      let best = 0;
      let bestDiff = Infinity;
      nextHours.forEach((h, i) => {
        const d = Math.abs(Date.parse(h.time) - target);
        if (d < bestDiff) {
          bestDiff = d;
          best = i;
        }
      });
      return best;
    }
  }
  let best = 0;
  let bestDiff = Infinity;
  nextHours.forEach((h, i) => {
    const d = Math.abs(Date.parse(h.time) - nowMs);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  });
  return best;
}
