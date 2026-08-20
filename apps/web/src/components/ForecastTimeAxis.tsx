import { useMemo } from "react";
import {
  CHART_PAD,
  CHART_W,
  buildDaySegs,
  buildHourLabels,
  buildTimeAxis,
} from "../lib/forecastChart";

type Props = {
  times: string[];
  hourIndex: number;
  onSelectHour: (index: number) => void;
  /** Stretch the axis to the plot width. */
  compact?: boolean;
};

const W = CHART_W;
const H = 36;
const PAD = CHART_PAD;

export function ForecastTimeAxis({
  times,
  hourIndex,
  onSelectHour,
  compact = false,
}: Props) {
  const axis = useMemo(() => {
    if (times.length === 0) return null;
    const { slot, barW, xBar, indexFromClientX } = buildTimeAxis(times.length);
    const hourLabels = buildHourLabels(times, (i) => xBar(i) + barW / 2);
    const daySegs = buildDaySegs(times);
    const dayLabels = daySegs.map((seg, idx) => {
      const x0 = xBar(seg.start);
      const x1 = xBar(seg.end) + barW;
      const w = x1 - x0;
      if (w < 80 && idx === 0) {
        return { text: seg.text, x: Math.max(PAD.left, x0), anchor: "start" as const };
      }
      if (w < 80 && idx === daySegs.length - 1) {
        return {
          text: seg.text,
          x: Math.min(W - PAD.right, x1),
          anchor: "end" as const,
        };
      }
      return { text: seg.text, x: (x0 + x1) / 2, anchor: "middle" as const };
    });
    const dayDividers = daySegs.slice(1).map((seg) => PAD.left + seg.start * slot);
    const selectedX = xBar(hourIndex);
    return { barW, xBar, hourLabels, dayLabels, dayDividers, selectedX, indexFromClientX };
  }, [times, hourIndex]);

  if (!axis) return null;

  return (
    <svg
      className="wind-chart-svg forecast-time-axis"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio={compact ? "none" : "xMinYMid meet"}
      role="img"
      aria-label="Forecast date and time"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSelectHour(
          axis.indexFromClientX(e.clientX - rect.left, rect.width, times.length),
        );
      }}
    >
      {axis.dayDividers.map((x) => (
        <line
          key={`div-${x}`}
          x1={x}
          x2={x}
          y1={2}
          y2={H - 2}
          className="wind-chart-day-div"
        />
      ))}
      {times.length > 0 && (
        <rect
          x={axis.selectedX - 0.6}
          y={2}
          width={axis.barW + 1.2}
          height={H - 4}
          className="wind-chart-selection"
        />
      )}
      {axis.dayLabels.map((d) => (
        <text
          key={`d-${d.text}-${d.x}`}
          x={d.x}
          y={13}
          className="wind-chart-day-top"
          textAnchor={d.anchor}
        >
          {d.text}
        </text>
      ))}
      {axis.hourLabels.map((h) => (
        <text
          key={`h-${h.text}-${h.x}`}
          x={h.x}
          y={H - 7}
          className="wind-chart-hour"
          textAnchor="middle"
        >
          {h.text}
        </text>
      ))}
    </svg>
  );
}
