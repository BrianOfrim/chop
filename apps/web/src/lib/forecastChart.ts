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
): Array<{ x: number; text: string }> {
  const step = hourStep(times.length);
  const labels: Array<{ x: number; text: string }> = [];
  times.forEach((time, i) => {
    const d = new Date(time);
    if (d.getHours() % step !== 0) return;
    labels.push({ x: xAt(i), text: formatHourLabel(d) });
  });
  if (times.length === 0) return labels;
  const first = new Date(times[0]!);
  if (first.getHours() % step === 0) return labels;
  const extra = { x: xAt(0), text: formatHourLabel(first) };
  if (labels[0] && labels[0].x - extra.x < MIN_HOUR_LABEL_DX) return labels;
  return [extra, ...labels];
}
