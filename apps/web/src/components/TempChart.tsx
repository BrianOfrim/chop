import { useMemo } from "react";
import type { WindHour } from "../lib/wind";
import {
  CHART_PAD,
  CHART_W,
  buildDaySegs,
  buildTimeAxis,
} from "../lib/forecastChart";
import {
  celsiusToTemp,
  niceTempRange,
  tempUnitLabel,
  type TempUnit,
} from "../lib/units";
import {
  DEFAULT_TEMP_SCALE,
  scaleGradientCss,
} from "../lib/colorScales";
import {
  TEMP_COLOR_MAX_C,
  TEMP_COLOR_MIN_C,
  tempColorCss,
} from "../lib/tempScale";
import { ColorScaleLegend } from "./ColorScaleLegend";

type Props = {
  hours: WindHour[];
  hourIndex: number;
  onSelectHour: (index: number) => void;
  tempUnit: TempUnit;
};

const W = CHART_W;
const H = 78;
const PAD = CHART_PAD;

export function TempChart({ hours, hourIndex, onSelectHour, tempUnit }: Props) {
  const chart = useMemo(() => {
    const vals = hours.map((h) =>
      h.tempC != null && Number.isFinite(h.tempC) ? h.tempC : null,
    );
    const known = vals.filter((v): v is number => v != null);
    if (known.length === 0) return null;
    const { min: yMin, max: yMax } = niceTempRange(
      Math.min(...known),
      Math.max(...known),
      tempUnit,
    );
    const innerH = H - PAD.top - PAD.bottom;
    const n = hours.length;
    const axis = buildTimeAxis(n);
    const { barW, xBar } = axis;
    const span = yMax - yMin || 1;
    const yAt = (v: number) => PAD.top + ((yMax - v) / span) * innerH;
    const baseline = yAt(yMin);
    const ticks = [yMin, (yMin + yMax) / 2, yMax];
    const daySegs = buildDaySegs(hours.map((h) => h.time));
    const dayDividers = daySegs.slice(1).map((seg) => xBar(seg.start));
    const bars = hours.map((_, i) => {
      const c = vals[i];
      const display = c == null ? null : celsiusToTemp(c, tempUnit);
      const top = display == null ? baseline : yAt(display);
      const height = display == null ? 0 : Math.max(0.8, baseline - top);
      return {
        i,
        x: xBar(i),
        top,
        height,
        fill: c == null ? "transparent" : tempColorCss(c),
        selected: i === hourIndex,
      };
    });
    return {
      axis,
      bars,
      barW,
      ticks,
      yAt,
      baseline,
      dayDividers,
      innerH,
      yMin,
      yMax,
    };
  }, [hours, hourIndex, tempUnit]);

  if (!chart) return null;

  const tickDigits = tempUnit === "F" ? 0 : 0;
  const scaleLabel = (c: number) =>
    celsiusToTemp(c, tempUnit).toFixed(tickDigits);

  return (
    <div className="wave-chart forecast-plot">
      <div className="forecast-plot-rail">
        <ColorScaleLegend
          orientation="vertical"
          gradient={scaleGradientCss(DEFAULT_TEMP_SCALE, "vertical")}
          labels={[
            scaleLabel(TEMP_COLOR_MIN_C),
            scaleLabel((TEMP_COLOR_MIN_C + TEMP_COLOR_MAX_C) / 2),
            scaleLabel(TEMP_COLOR_MAX_C),
          ]}
          unit={tempUnitLabel(tempUnit)}
        />
        <span className="forecast-plot-title">Temp</span>
      </div>
      <svg
        className="wind-chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label="Temperature at 2 m over the forecast period"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onSelectHour(
            chart.axis.indexFromClientX(
              e.clientX - rect.left,
              rect.width,
              hours.length,
            ),
          );
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
        {chart.ticks.map((v) => (
          <g key={`tick-${v}`}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={chart.yAt(v)}
              y2={chart.yAt(v)}
              className="wind-chart-grid"
            />
            <text
              x={PAD.left - 4}
              y={chart.yAt(v) + 3}
              className="wind-chart-tick hs"
              textAnchor="end"
            >
              {v.toFixed(tickDigits)}
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
        {chart.bars.map((b) =>
          b.height > 0 ? (
            <rect
              key={b.i}
              x={b.x}
              y={b.top}
              width={chart.barW}
              height={b.height}
              fill={b.fill}
              className="wind-chart-bar"
              rx={0.6}
            />
          ) : null,
        )}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={chart.baseline}
          y2={chart.baseline}
          className="wind-chart-baseline"
        />
      </svg>
    </div>
  );
}

export function hasTempHours(hours: WindHour[]): boolean {
  return hours.some((h) => h.tempC != null && Number.isFinite(h.tempC));
}
