import { useMemo } from "react";
import { CHART_PAD, CHART_W, buildTimeAxis } from "../lib/forecastChart";
import {
  formatWindSpeed,
  mpsToWind,
  niceWindMax,
  windUnitLabel,
  type WindSpeedUnit,
} from "../lib/units";
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

export function SessionSpeedChart({
  samples,
  sampleIndex,
  onSelectSample,
  windUnit,
}: Props) {
  const chart = useMemo(() => {
    if (samples.length === 0) return null;
    if (!samples.some((s) => s.speedMps != null)) return null;

    const vals = samples.map((s) =>
      s.speedMps != null ? mpsToWind(s.speedMps, windUnit) : null,
    );
    const peak = Math.max(
      ...vals.filter((v): v is number => v != null),
      mpsToWind(1, windUnit),
    );
    const yMax = niceWindMax(peak, windUnit);
    const innerH = H - PAD.top - PAD.bottom;
    const n = samples.length;
    const axis = buildTimeAxis(n);
    const { barW, xBar, xCenter } = axis;
    const yAt = (v: number) => PAD.top + innerH * (1 - v / yMax);
    const baseline = PAD.top + innerH;
    const tickDigits = windUnit === "mps" ? 1 : 0;

    const points = samples.map((s, i) => {
      const v = vals[i];
      return {
        i,
        x: xCenter(i),
        barX: xBar(i),
        y: v != null ? yAt(v) : null,
        selected: i === sampleIndex,
        missing: v == null,
      };
    });

    const line = points
      .filter((p) => p.y != null)
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y!.toFixed(1)}`)
      .join(" ");
    const drawn = points.filter((p) => p.y != null);
    const area =
      drawn.length > 1
        ? `${line} L${drawn[drawn.length - 1]!.x.toFixed(1)},${baseline} L${drawn[0]!.x.toFixed(1)},${baseline} Z`
        : "";

    return {
      axis,
      points,
      barW,
      line,
      area,
      ticks: [0, yMax / 2, yMax],
      yAt,
      baseline,
      innerH,
      tickDigits,
    };
  }, [samples, sampleIndex, windUnit]);

  if (!chart) return null;

  return (
    <div className="session-speed-chart forecast-plot">
      <div className="forecast-plot-rail">
        <span aria-hidden />
        <span className="forecast-plot-unit">{windUnitLabel(windUnit)}</span>
        <span className="forecast-plot-title">Speed</span>
      </div>
      <svg
        className="wind-chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label="GPS speed during the session"
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
        {chart.area && <path d={chart.area} className="session-speed-area" />}
        {chart.line && <path d={chart.line} className="session-speed-line" />}
        {chart.points.map((p) =>
          p.y == null ? null : (
            <circle
              key={p.i}
              cx={p.x}
              cy={p.y}
              r={p.selected ? 3.2 : 1.6}
              className={
                p.selected
                  ? "session-speed-dot selected"
                  : "session-speed-dot"
              }
            />
          ),
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

export function sessionSpeedLabel(
  speedMps: number | null | undefined,
  unit: WindSpeedUnit,
): string | null {
  if (speedMps == null || !Number.isFinite(speedMps)) return null;
  return formatWindSpeed(speedMps, unit);
}
