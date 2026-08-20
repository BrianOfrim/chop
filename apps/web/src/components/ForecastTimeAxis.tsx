import { useMemo } from "react";
import {
  CHART_PAD,
  CHART_W,
  buildDaySegs,
  buildHourLabels,
  buildClockIntervalLabels,
  buildTimeAxis,
} from "../lib/forecastChart";
import {
  dominantPrecip,
  formatRadarPrecipCopy,
  precipBarFill,
  radarRateToT,
  type RadarPrecipFrame,
  type RadarPrecipMode,
} from "../lib/radarPrecip";

type Props = {
  times: string[];
  hourIndex: number;
  onSelectHour: (index: number) => void;
  /** Stretch the axis to the plot width. */
  compact?: boolean;
  /** Label every Nth clock hour. Radar uses 1 so 6-min frames do not repeat. */
  hourLabelStep?: number;
  /** When set, label wall-clock times at this minute interval (radar uses 15). */
  minuteLabelStep?: number;
  precip?: ReadonlyArray<RadarPrecipFrame | null>;
  precipMode?: RadarPrecipMode;
  /** Frames after this index are nowcast (drawn slightly faded). */
  liveIndex?: number;
};

const W = CHART_W;
const LABEL_H = 36;
const BAR_BAND = 16;
const PAD = CHART_PAD;

export function ForecastTimeAxis({
  times,
  hourIndex,
  onSelectHour,
  compact = false,
  hourLabelStep,
  minuteLabelStep,
  precip,
  precipMode = "lake",
  liveIndex,
}: Props) {
  const showPrecip = precip != null;
  const H = showPrecip ? LABEL_H + BAR_BAND : LABEL_H;

  const axis = useMemo(() => {
    if (times.length === 0) return null;
    const { slot, barW, xBar, indexFromClientX } = buildTimeAxis(times.length);
    const xCenter = (i: number) => xBar(i) + barW / 2;
    const hourLabels =
      minuteLabelStep != null
        ? buildClockIntervalLabels(times, xCenter, minuteLabelStep)
        : buildHourLabels(times, xCenter, hourLabelStep);
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
    const precipBars = showPrecip
      ? times.map((_, i) => {
          const sample = precip[i];
          if (!sample) return null;
          const nowcast = liveIndex != null && i > liveIndex;
          if (sample.pending) {
            return {
              i,
              x: xBar(i),
              y: LABEL_H + BAR_BAND - 5,
              w: barW,
              h: 4,
              fill: "currentColor",
              pending: true,
              nowcast,
              title: "Loading precipitation",
            };
          }
          const fill = precipBarFill(sample.rainMmH, sample.snowCmH);
          if (!fill) return null;
          const t = radarRateToT(
            dominantPrecip(sample.rainMmH, sample.snowCmH).rate,
          );
          const h = 2 + t * (BAR_BAND - 4);
          return {
            i,
            x: xBar(i),
            y: LABEL_H + BAR_BAND - h - 1,
            w: barW,
            h,
            fill,
            pending: false,
            nowcast,
            title: formatRadarPrecipCopy(
              sample.rainMmH,
              sample.snowCmH,
              sample.mode || precipMode,
            ),
          };
        })
      : [];
    return {
      barW,
      xBar,
      hourLabels,
      dayLabels,
      dayDividers,
      selectedX,
      indexFromClientX,
      precipBars,
    };
  }, [
    times,
    hourIndex,
    hourLabelStep,
    minuteLabelStep,
    precip,
    precipMode,
    liveIndex,
    showPrecip,
  ]);

  if (!axis) return null;

  return (
    <svg
      className="wind-chart-svg forecast-time-axis"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio={compact ? "none" : "xMinYMid meet"}
      role="img"
      aria-label={
        showPrecip
          ? precipMode === "pin"
            ? "Radar time and precipitation at pin"
            : "Radar time and lake precipitation"
          : "Forecast date and time"
      }
      aria-busy={
        precip?.some((sample) => sample?.pending) ? true : undefined
      }
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
      {axis.precipBars.map((b) =>
        b ? (
          <rect
            key={`p-${b.i}`}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            fill={b.pending ? undefined : b.fill}
            className={[
              "radar-precip-bar",
              b.nowcast ? "is-nowcast" : "",
              b.pending ? "is-pending" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={
              b.pending
                ? { animationDelay: `${(b.i % 10) * 0.08}s` }
                : undefined
            }
            rx={0.6}
          >
            <title>{b.title}</title>
          </rect>
        ) : null,
      )}
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
          y={LABEL_H - 7}
          className="wind-chart-hour"
          textAnchor="middle"
        >
          {h.text}
        </text>
      ))}
    </svg>
  );
}
