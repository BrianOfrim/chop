import { useMemo } from "react";
import { CHART_PAD, CHART_W, buildTimeAxis } from "../lib/forecastChart";
import type { SessionSample } from "../lib/sessionTrack";

type Props = {
  samples: SessionSample[];
  sampleIndex: number;
  onSelectSample: (index: number) => void;
};

const W = CHART_W;
const H = 92;
const PAD = { ...CHART_PAD, bottom: 16 };
const Y_MAX = 90;

export function SessionPointChart({
  samples,
  sampleIndex,
  onSelectSample,
}: Props) {
  const chart = useMemo(() => {
    if (samples.length === 0) return null;
    if (!samples.some((s) => s.pointDeg != null)) return null;

    const innerH = H - PAD.top - PAD.bottom;
    const n = samples.length;
    const axis = buildTimeAxis(n);
    const { barW, xBar, xCenter } = axis;
    const yAt = (v: number) => PAD.top + (innerH * (Y_MAX - v)) / (2 * Y_MAX);
    const reachY = yAt(0);
    const baseline = PAD.top + innerH;

    const points = samples.map((s, i) => {
      const v = s.pointDeg;
      return {
        i,
        x: xCenter(i),
        barX: xBar(i),
        y: v != null ? yAt(v) : null,
        upwind: v != null && v >= 0,
        selected: i === sampleIndex,
      };
    });

    const line = points
      .filter((p) => p.y != null)
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y!.toFixed(1)}`)
      .join(" ");

    return {
      axis,
      points,
      barW,
      line,
      ticks: [
        { v: 90, label: "Up" },
        { v: 0, label: "Reach" },
        { v: -90, label: "Down" },
      ],
      yAt,
      reachY,
      baseline,
      innerH,
    };
  }, [samples, sampleIndex]);

  if (!chart) return null;

  return (
    <div className="session-point-chart forecast-plot">
      <div className="forecast-plot-rail">
        <span aria-hidden />
        <span className="forecast-plot-unit">vs wind</span>
        <span className="forecast-plot-title">Point</span>
      </div>
      <svg
        className="wind-chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label="Course relative to the wind: upwind, reach, or downwind"
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
        {chart.ticks.map((t) => (
          <g key={`tick-${t.v}`}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={chart.yAt(t.v)}
              y2={chart.yAt(t.v)}
              className={t.v === 0 ? "session-point-reach" : "wind-chart-grid"}
            />
            <text
              x={PAD.left - 4}
              y={chart.yAt(t.v) + 3}
              className="wind-chart-tick"
              textAnchor="end"
            >
              {t.label}
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
        {chart.line && <path d={chart.line} className="session-point-line" />}
        {chart.points.map((p) =>
          p.y == null ? null : (
            <circle
              key={p.i}
              cx={p.x}
              cy={p.y}
              r={p.selected ? 3.2 : 1.6}
              className={[
                "session-point-dot",
                p.upwind ? "upwind" : "downwind",
                p.selected ? "selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
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
