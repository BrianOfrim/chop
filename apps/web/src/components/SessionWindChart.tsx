import { useMemo } from "react";
import {
  CHART_PAD,
  CHART_W,
  buildTimeAxis,
} from "../lib/forecastChart";
import {
  mpsToWind,
  niceWindMax,
  windUnitLabel,
  type WindSpeedUnit,
} from "../lib/units";
import {
  DEFAULT_WIND_SCALE,
  scaleGradientCss,
} from "../lib/colorScales";
import { WIND_COLOR_MAX_MPS, windColorCss } from "../lib/windScale";
import { ColorScaleLegend } from "./ColorScaleLegend";
import type { SessionSample } from "../lib/sessionTrack";

type Props = {
  samples: SessionSample[];
  sampleIndex: number;
  onSelectSample: (index: number) => void;
  windUnit: WindSpeedUnit;
};

const W = CHART_W;
const H = 92;
const PAD = { ...CHART_PAD, bottom: 16 };
const DIR_BAND = 12;

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

export function SessionWindChart({
  samples,
  sampleIndex,
  onSelectSample,
  windUnit,
}: Props) {
  const chart = useMemo(() => {
    if (samples.length === 0) return null;
    const windVals = samples.map((s) => mpsToWind(s.wind.windSpeedMps, windUnit));
    const gustVals = samples.map((s) =>
      s.wind.gustMps != null && Number.isFinite(s.wind.gustMps)
        ? mpsToWind(s.wind.gustMps, windUnit)
        : null,
    );
    const maxVal = Math.max(
      ...windVals,
      ...gustVals.filter((v): v is number => v != null),
      mpsToWind(1, windUnit),
    );
    const yMax = niceWindMax(maxVal, windUnit);

    const innerH = H - PAD.top - PAD.bottom;
    const n = samples.length;
    const axis = buildTimeAxis(n);
    const { slot, barW, xBar, xCenter } = axis;
    const yAt = (v: number) => PAD.top + innerH * (1 - v / yMax);
    const baseline = PAD.top + innerH;
    const dirY = baseline + DIR_BAND * 0.55;
    const dirEvery = slot < 5 ? 3 : slot < 8 ? 2 : 1;

    const points = samples.map((s, i) => {
      const wind = windVals[i]!;
      const gust = gustVals[i];
      return {
        i,
        x: xCenter(i),
        barX: xBar(i),
        y: yAt(wind),
        gustY: gust != null ? yAt(gust) : null,
        toBearing: (s.wind.windDirDeg + 180) % 360,
        showDir: i === sampleIndex || i % dirEvery === 0,
        selected: i === sampleIndex,
        fill: windColorCss(s.wind.windSpeedMps, WIND_COLOR_MAX_MPS, DEFAULT_WIND_SCALE),
      };
    });

    const line = points
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ");
    const area =
      points.length > 1
        ? `${line} L${points[points.length - 1]!.x.toFixed(1)},${baseline} L${points[0]!.x.toFixed(1)},${baseline} Z`
        : "";

    const gustLine = points
      .filter((p) => p.gustY != null)
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.gustY!.toFixed(1)}`)
      .join(" ");

    const ticks = [0, yMax / 2, yMax];
    const tickDigits = windUnit === "mps" ? 1 : 0;

    return {
      axis,
      points,
      barW,
      line,
      area,
      gustLine,
      ticks,
      yAt,
      baseline,
      dirY,
      innerH,
      tickDigits,
    };
  }, [samples, sampleIndex, windUnit]);

  if (!chart) return null;

  return (
    <div className="session-wind-chart forecast-plot">
      <div className="forecast-plot-rail">
        <ColorScaleLegend
          orientation="vertical"
          gradient={scaleGradientCss(DEFAULT_WIND_SCALE, "vertical")}
          labels={[
            windScaleLabel(0, windUnit),
            windScaleLabel(WIND_COLOR_MAX_MPS / 2, windUnit),
            windScaleLabel(WIND_COLOR_MAX_MPS, windUnit),
          ]}
          unit={windUnitLabel(windUnit)}
        />
        <span className="forecast-plot-title">Wind</span>
      </div>
      <svg
        className="wind-chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label="Wind speed and direction during the session"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onSelectSample(
            chart.axis.indexFromClientX(
              e.clientX - rect.left,
              rect.width,
              samples.length,
            ),
          );
        }}
      >
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
        {chart.points[sampleIndex] && (
          <rect
            x={chart.points[sampleIndex]!.barX - 0.6}
            y={PAD.top}
            width={chart.barW + 1.2}
            height={chart.innerH}
            className="wind-chart-selection"
          />
        )}
        {chart.area && <path d={chart.area} className="session-wind-area" />}
        {chart.line && <path d={chart.line} className="session-wind-line" />}
        {chart.gustLine && (
          <path d={chart.gustLine} className="session-wind-gust-line" />
        )}
        {chart.points.map((p) => (
          <circle
            key={p.i}
            cx={p.x}
            cy={p.y}
            r={p.selected ? 3.2 : 1.6}
            fill={p.fill}
            className={
              p.selected ? "session-wave-dot selected" : "session-wave-dot"
            }
          />
        ))}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={chart.baseline}
          y2={chart.baseline}
          className="wind-chart-baseline"
        />
        {chart.points
          .filter((p) => p.showDir)
          .map((p) => (
            <DirArrow
              key={`dir-${p.i}`}
              x={p.x}
              y={chart.dirY}
              toBearing={p.toBearing}
              selected={p.selected}
            />
          ))}
      </svg>
    </div>
  );
}
