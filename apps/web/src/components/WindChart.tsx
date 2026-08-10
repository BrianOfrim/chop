import { useMemo } from "react";
import type { WindHour } from "../lib/wind";

type Props = {
  hours: WindHour[];
  hourIndex: number;
  onSelectHour: (index: number) => void;
};

const W = 520;
const H = 108;
const PAD = { top: 22, right: 10, bottom: 28, left: 28 };
const GUST_CAP_H = 2.5;
const BAR_GAP = 1.2;

function toKt(mps: number): number {
  return mps * 1.94384;
}

function hourStep(n: number): number {
  if (n <= 60) return 3;
  return 6;
}

function formatHourLabel(d: Date): string {
  return d
    .toLocaleTimeString(undefined, { hour: "numeric" })
    .replace(/\s/g, "")
    .toLowerCase();
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function WindChart({ hours, hourIndex, onSelectHour }: Props) {
  const chart = useMemo(() => {
    if (hours.length === 0) return null;
    const windKt = hours.map((h) => toKt(h.windSpeedMps));
    const gustKt = hours.map((h) =>
      h.gustMps != null && Number.isFinite(h.gustMps) ? toKt(h.gustMps) : null,
    );
    const maxKt = Math.max(
      10,
      ...windKt,
      ...gustKt.filter((v): v is number => v != null),
    );
    const yMax = Math.ceil(maxKt / 5) * 5;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const n = hours.length;
    const slot = innerW / n;
    const barW = Math.max(1.5, slot - BAR_GAP);

    const yAt = (kt: number) => PAD.top + innerH * (1 - kt / yMax);
    const baseline = PAD.top + innerH;
    const xBar = (i: number) => PAD.left + i * slot + (slot - barW) / 2;

    const bars = hours.map((_, i) => {
      const wind = windKt[i]!;
      const gust = gustKt[i];
      const x = xBar(i);
      const windTop = yAt(wind);
      const windH = Math.max(0, baseline - windTop);
      let gustY: number | null = null;
      if (gust != null && gust > wind + 0.15) {
        // Cap sits at gust height; leave a visible gap above the wind bar
        gustY = Math.min(yAt(gust), windTop - GUST_CAP_H - 1.5);
      } else if (gust != null) {
        gustY = yAt(Math.max(gust, wind + 0.5));
      }
      return { i, x, windTop, windH, gustY, selected: i === hourIndex };
    });

    const ticks = [0, yMax / 2, yMax];
    const step = hourStep(n);

    const hourLabels: Array<{ x: number; text: string }> = [];
    hours.forEach((h, i) => {
      const d = new Date(h.time);
      if (i !== 0 && d.getHours() % step !== 0) return;
      hourLabels.push({
        x: xBar(i) + barW / 2,
        text: formatHourLabel(d),
      });
    });

    // Day segments: top-centered labels + vertical dividers
    type DaySeg = { key: string; text: string; start: number; end: number };
    const daySegs: DaySeg[] = [];
    hours.forEach((h, i) => {
      const d = new Date(h.time);
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

    const dayLabels = daySegs.map((seg) => ({
      text: seg.text,
      x: (xBar(seg.start) + xBar(seg.end) + barW) / 2,
    }));

    const dayDividers = daySegs.slice(1).map((seg) => PAD.left + seg.start * slot);

    return {
      bars,
      barW,
      ticks,
      yAt,
      baseline,
      hourLabels,
      dayLabels,
      dayDividers,
      innerH,
      yMax,
    };
  }, [hours, hourIndex]);

  if (!chart) return null;

  return (
    <div className="wind-chart">
      <div className="wind-chart-header">
        <span className="wind-chart-title">Wind forecast</span>
        <span className="wind-chart-legend">
          <span className="swatch wind-bar" /> Speed
          <span className="swatch gust-cap" /> Gust
        </span>
      </div>
      <svg
        className="wind-chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Wind and gust speed over the forecast period"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const frac = (e.clientX - rect.left) / rect.width;
          const idx = Math.round(frac * (hours.length - 1));
          onSelectHour(Math.max(0, Math.min(hours.length - 1, idx)));
        }}
      >
        {chart.dayDividers.map((x) => (
          <line
            key={`div-${x}`}
            x1={x}
            x2={x}
            y1={4}
            y2={chart.baseline}
            className="wind-chart-day-div"
          />
        ))}
        {chart.dayLabels.map((d) => (
          <text
            key={`d-${d.text}-${d.x}`}
            x={d.x}
            y={14}
            className="wind-chart-day-top"
            textAnchor="middle"
          >
            {d.text}
          </text>
        ))}
        {chart.ticks.map((kt) => (
          <g key={kt}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={chart.yAt(kt)}
              y2={chart.yAt(kt)}
              className="wind-chart-grid"
            />
            <text
              x={PAD.left - 4}
              y={chart.yAt(kt) + 3}
              className="wind-chart-tick"
              textAnchor="end"
            >
              {kt}
            </text>
          </g>
        ))}
        {chart.bars[hourIndex] && (
          <rect
            x={chart.bars[hourIndex]!.x - 0.6}
            y={PAD.top}
            width={chart.barW + 1.2}
            height={chart.innerH}
            className="wind-chart-selection"
          />
        )}
        {chart.bars.map((b) => (
          <g key={b.i} className={b.selected ? "wind-bar-group selected" : "wind-bar-group"}>
            <rect
              x={b.x}
              y={b.windTop}
              width={chart.barW}
              height={b.windH}
              className="wind-chart-bar"
              rx={0.6}
            />
            {b.gustY != null && (
              <rect
                x={b.x}
                y={b.gustY}
                width={chart.barW}
                height={GUST_CAP_H}
                className="wind-chart-gust-cap"
                rx={0.8}
              />
            )}
          </g>
        ))}
        {chart.hourLabels.map((h) => (
          <text
            key={`h-${h.text}-${h.x}`}
            x={h.x}
            y={H - 10}
            className="wind-chart-hour"
            textAnchor="middle"
          >
            {h.text}
          </text>
        ))}
      </svg>
    </div>
  );
}
