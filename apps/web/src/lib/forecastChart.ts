/** Shared layout helpers for forecast time charts. */

export const CHART_W = 720;
export const CHART_PAD = { top: 24, right: 28, bottom: 42, left: 32 };

export function hourStep(n: number): number {
  if (n <= 60) return 3;
  return 6;
}

export function formatHourLabel(d: Date): string {
  return d
    .toLocaleTimeString(undefined, { hour: "numeric" })
    .replace(/\s/g, "")
    .toLowerCase();
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
    if (i !== 0 && d.getHours() % step !== 0) return;
    labels.push({ x: xAt(i), text: formatHourLabel(d) });
  });
  return labels;
}
