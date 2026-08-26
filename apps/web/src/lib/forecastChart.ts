/** Shared layout helpers for forecast time charts. */

export const CHART_W = 1100;
/** Shared left/right so wind, wave, and the time axis stay aligned. */
export const CHART_PAD = { top: 6, right: 28, bottom: 4, left: 32 };
/** Extra bottom band on the wind plot for direction arrows. */
export const CHART_WIND_PAD = { ...CHART_PAD, bottom: 20 };
export const CHART_BAR_GAP = 1.4;

export type TimeAxis = {
  slot: number;
  barW: number;
  xBar: (i: number) => number;
  xCenter: (i: number) => number;
  indexFromClientX: (clientX: number, svgWidth: number, n: number) => number;
};

export function buildTimeAxis(n: number): TimeAxis {
  const innerW = CHART_W - CHART_PAD.left - CHART_PAD.right;
  const slot = innerW / Math.max(n, 1);
  const barW = Math.max(1.8, slot - CHART_BAR_GAP);
  const xBar = (i: number) => CHART_PAD.left + i * slot + (slot - barW) / 2;
  return {
    slot,
    barW,
    xBar,
    xCenter: (i: number) => xBar(i) + barW / 2,
    indexFromClientX(clientX, svgWidth, count) {
      if (svgWidth <= 0 || count <= 0) return 0;
      const x = (clientX / svgWidth) * CHART_W;
      const i = Math.floor((x - CHART_PAD.left) / slot);
      return Math.max(0, Math.min(count - 1, i));
    },
  };
}

/** Chart x for a wall-clock time, interpolated along a sample series. */
export function xAtTimeMs(
  timeMs: number,
  times: ReadonlyArray<{ timeMs: number }>,
  xAtIndex: (i: number) => number,
): number {
  const n = times.length;
  if (n === 0) return CHART_PAD.left;
  if (n === 1 || timeMs <= times[0]!.timeMs) return xAtIndex(0);
  const last = n - 1;
  if (timeMs >= times[last]!.timeMs) return xAtIndex(last);
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]!.timeMs <= timeMs) lo = mid;
    else hi = mid;
  }
  const t0 = times[lo]!.timeMs;
  const t1 = times[hi]!.timeMs;
  const x0 = xAtIndex(lo);
  const x1 = xAtIndex(hi);
  if (t1 === t0) return x0;
  return x0 + ((timeMs - t0) / (t1 - t0)) * (x1 - x0);
}

/** CSS padding so a full-width slider thumb tracks hour bar centers. */
export function sliderInsetStyle(n: number): {
  paddingLeft: string;
  paddingRight: string;
} {
  const axis = buildTimeAxis(Math.max(n, 1));
  const last = Math.max(0, n - 1);
  return {
    paddingLeft: `${(axis.xCenter(0) / CHART_W) * 100}%`,
    paddingRight: `${((CHART_W - axis.xCenter(last)) / CHART_W) * 100}%`,
  };
}

export function hourStep(n: number): number {
  if (n <= 60) return 3;
  if (n <= 168) return 6;
  return 12;
}

/** Centers closer than this (chart units) overlap at 8px hour-label size. */
const MIN_HOUR_LABEL_DX = 42;

export function formatHourLabel(d: Date): string {
  return d
    .toLocaleTimeString(undefined, { hour: "numeric" })
    .replace(/\s/g, "")
    .toLowerCase();
}

export function formatHourMinuteLabel(d: Date): string {
  return d
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .replace(/\s/g, "")
    .toLowerCase();
}

/**
 * Wall-clock labels at a fixed minute interval, placed by time along the series.
 * 15-min marks still line up on a 6-min radar slider.
 */
export function buildClockIntervalLabels(
  times: string[],
  xAt: (i: number) => number,
  intervalMin: number,
): Array<{ x: number; text: string }> {
  if (times.length === 0 || !(intervalMin > 0)) return [];
  const start = Date.parse(times[0]!);
  const end = Date.parse(times[times.length - 1]!);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return [];
  }
  const x0 = xAt(0);
  const x1 = xAt(times.length - 1);
  const step = intervalMin * 60 * 1000;
  const span = end - start || 1;
  let t = Math.ceil(start / step) * step;
  const labels: Array<{ x: number; text: string }> = [];
  while (t <= end + 1) {
    const x = x0 + ((t - start) / span) * (x1 - x0);
    labels.push({ x, text: formatHourMinuteLabel(new Date(t)) });
    t += step;
  }
  return labels;
}

/** Selected forecast hour, e.g. "Wed, Aug 19, 10 PM". */
export function formatSelectedWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
  });
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export type DaySeg = { key: string; text: string; start: number; end: number };

export function buildDaySegs(times: string[]): DaySeg[] {
  const daySegs: DaySeg[] = [];
  times.forEach((time, i) => {
    const d = new Date(time);
    const key = dayKey(d);
    const last = daySegs[daySegs.length - 1];
    if (!last || last.key !== key) {
      daySegs.push({
        key,
        text: d.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
        start: i,
        end: i,
      });
    } else {
      last.end = i;
    }
  });
  return daySegs;
}

export function buildHourLabels(
  times: string[],
  xAt: (i: number) => number,
  step = hourStep(times.length),
): Array<{ x: number; text: string }> {
  const labels: Array<{ x: number; text: string }> = [];
  let lastKey: string | null = null;
  times.forEach((time, i) => {
    const d = new Date(time);
    if (d.getHours() % step !== 0) return;
    const key = `${dayKey(d)}-${d.getHours()}`;
    if (key === lastKey) return;
    lastKey = key;
    labels.push({ x: xAt(i), text: formatHourLabel(d) });
  });
  if (times.length === 0) return labels;
  const first = new Date(times[0]!);
  if (first.getHours() % step === 0) return labels;
  const extra = { x: xAt(0), text: formatHourLabel(first) };
  if (labels[0] && labels[0].x - extra.x < MIN_HOUR_LABEL_DX) return labels;
  return [extra, ...labels];
}
