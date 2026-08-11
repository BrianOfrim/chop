import { useMemo } from "react";
import type { WindHour } from "../lib/wind";
import {
  CHART_PAD,
  CHART_W,
  buildDaySegs,
  buildHourLabels,
} from "../lib/forecastChart";
import {
  mpsToWind,
  niceWindMax,
  windUnitLabel,
  type WindSpeedUnit,
} from "../lib/units";
import { WIND_COLOR_MAX_MPS, windColorCss } from "../lib/windScale";
import {
  DEFAULT_WIND_SCALE,
  scaleGradientCss,
} from "../lib/colorScales";
import { ColorScaleLegend } from "./ColorScaleLegend";

type Props = {
  hours: WindHour[];
  hourIndex: number;
  onSelectHour: (index: number) => void;
  windUnit: WindSpeedUnit;
};

const H = 168;
const PAD = { ...CHART_PAD, right: 28 };
const GUST_CAP_H = 2.8;
const BAR_GAP = 1.4;
const DIR_BAND = 14;
const W = CHART_W;

function windScaleLabel(mps: number, unit: WindSpeedUnit): string {
  const v = mpsToWind(mps, unit);
  return v.toFixed(unit === "mps" ? 1 : 0);
}

function DirArrow({
  x,
  y,
  toBearing,
  selected,
}: {
  x: number;
  y: number;
  toBearing: number;
  selected: boolean;
}) {
  return (
    <g
      className={selected ? "wind-chart-dir selected" : "wind-chart-dir"}
      transform={`translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${toBearing.toFixed(1)})`}
    >
      <path d="M0,-4.2 L2.4,3.4 L0,1.4 L-2.4,3.4 Z" />
    </g>
  );
}

export function WindChart({ hours, hourIndex, onSelectHour, windUnit }: Props) {
  const chart = useMemo(() => {
    if (hours.length === 0) return null;
    const windVals = hours.map((h) => mpsToWind(h.windSpeedMps, windUnit));
    const gustVals = hours.map((h) =>
      h.gustMps != null && Number.isFinite(h.gustMps)
        ? mpsToWind(h.gustMps, windUnit)
        : null,
    );
    const maxVal = Math.max(
      ...windVals,
      ...gustVals.filter((v): v is number => v != null),
    );
    const yMax = niceWindMax(maxVal, windUnit);

    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const n = hours.length;
    const slot = innerW / n;
    const barW = Math.max(1.8, slot - BAR_GAP);
    const dirEvery = slot < 5 ? 3 : slot < 8 ? 2 : 1;

    const yAt = (v: number) => PAD.top + innerH * (1 - v / yMax);
    const baseline = PAD.top + innerH;
    const dirY = baseline + DIR_BAND * 0.55;
    const xBar = (i: number) => PAD.left + i * slot + (slot - barW) / 2;
    const gustGap = windUnit === "mps" ? 0.15 : 0.5;

    const bars = hours.map((h, i) => {
      const wind = windVals[i]!;
      const gust = gustVals[i];
      const x = xBar(i);
      const windTop = yAt(wind);
      const windH = Math.max(0, baseline - windTop);
      let gustY: number | null = null;
      if (gust != null && gust > wind + gustGap * 0.3) {
        gustY = Math.min(yAt(gust), windTop - GUST_CAP_H - 1.5);
      } else if (gust != null) {
        gustY = yAt(Math.max(gust, wind + gustGap));
      }
      const toBearing = (h.windDirDeg + 180) % 360;
      const showDir = i === hourIndex || i % dirEvery === 0;
      return {
        i,
        x,
        cx: x + barW / 2,
        windTop,
        windH,
        gustY,
        toBearing,
        showDir,
        selected: i === hourIndex,
        fill: windColorCss(h.windSpeedMps, WIND_COLOR_MAX_MPS, DEFAULT_WIND_SCALE),
        gustFill:
          h.gustMps != null && Number.isFinite(h.gustMps)
            ? windColorCss(h.gustMps, WIND_COLOR_MAX_MPS, DEFAULT_WIND_SCALE)
            : null,
      };
    });

    const ticks = [0, yMax / 2, yMax];
    const times = hours.map((h) => h.time);
    const hourLabels = buildHourLabels(times, (i) => xBar(i) + barW / 2);
    const daySegs = buildDaySegs(times);
    const dayLabels = daySegs.map((seg) => ({
      text: seg.text,
      x: (xBar(seg.start) + xBar(seg.end) + barW) / 2,
    }));
    const dayDividers = daySegs.slice(1).map((seg) => PAD.left + seg.start * slot);
    const tickDigits = windUnit === "mps" ? 1 : 0;

    return {
      bars,
      barW,
      ticks,
      yAt,
      baseline,
      dirY,
      hourLabels,
      dayLabels,
      dayDividers,
      innerH,
      unitLabel: windUnitLabel(windUnit),
      tickDigits,
      gradient: scaleGradientCss(DEFAULT_WIND_SCALE),
    };
  }, [hours, hourIndex, windUnit]);

  if (!chart) return null;

  return (
    <div className="wind-chart">
      <div className="wind-chart-header">
        <span className="wind-chart-title">Wind</span>
        <span className="wind-chart-legend">
          <ColorScaleLegend
            gradient={chart.gradient}
            labels={[
              windScaleLabel(0, windUnit),
              windScaleLabel(WIND_COLOR_MAX_MPS / 2, windUnit),
              windScaleLabel(WIND_COLOR_MAX_MPS, windUnit),
            ]}
            unit={windUnitLabel(windUnit)}
          />
          <span className="swatch gust-cap" /> Gust
          <span className="swatch wind-dir" aria-hidden>
            ▲
          </span>{" "}
          To
        </span>
      </div>
      <svg
        className="wind-chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Wind speed, gust, and direction over the forecast period"
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
            y2={chart.baseline + DIR_BAND}
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
              className="wind-chart-tick"
              textAnchor="end"
            >
              {v.toFixed(chart.tickDigits)}
            </text>
          </g>
        ))}
        <text
          x={10}
          y={PAD.top - 8}
          className="wind-chart-axis-label"
          textAnchor="start"
        >
          {chart.unitLabel}
        </text>
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
              fill={b.fill}
              className="wind-chart-bar"
              rx={0.6}
            />
            {b.gustY != null && (
              <rect
                x={b.x}
                y={b.gustY}
                width={chart.barW}
                height={GUST_CAP_H}
                fill={b.gustFill ?? b.fill}
                className="wind-chart-gust-cap"
                rx={0.8}
              />
            )}
          </g>
        ))}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={chart.baseline}
          y2={chart.baseline}
          className="wind-chart-baseline"
        />
        {chart.bars
          .filter((b) => b.showDir)
          .map((b) => (
            <DirArrow
              key={`dir-${b.i}`}
              x={b.cx}
              y={chart.dirY}
              toBearing={b.toBearing}
              selected={b.selected}
            />
          ))}
        {chart.hourLabels.map((h) => (
          <text
            key={`h-${h.text}-${h.x}`}
            x={h.x}
            y={H - 8}
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
