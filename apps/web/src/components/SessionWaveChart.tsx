import { useMemo } from "react";
import { hsColor, HS_COLOR_MAX_M } from "../lib/hsOverlay";
import {
  CHART_PAD,
  CHART_W,
  buildTimeAxis,
  formatHourLabel,
} from "../lib/forecastChart";
import {
  formatWaveHeight,
  metersToWave,
  niceWaveMax,
  waveUnitLabel,
  type WaveHeightUnit,
} from "../lib/units";
import {
  DEFAULT_WAVE_SCALE,
  scaleGradientCss,
} from "../lib/colorScales";
import { ColorScaleLegend } from "./ColorScaleLegend";
import type { SessionSample } from "../lib/sessionTrack";

type Props = {
  samples: SessionSample[];
  sampleIndex: number;
  onSelectSample: (index: number) => void;
  waveUnit: WaveHeightUnit;
};

const W = CHART_W;
const H = 96;
const PAD = { ...CHART_PAD, bottom: 18 };

function formatTick(v: number, unit: WaveHeightUnit): string {
  if (unit === "m") return v.toFixed(1);
  if (unit === "ft") return v.toFixed(1);
  return v.toFixed(0);
}

function waveScaleLabel(m: number, unit: WaveHeightUnit): string {
  return formatTick(metersToWave(m, unit), unit);
}

export function SessionWaveChart({
  samples,
  sampleIndex,
  onSelectSample,
  waveUnit,
}: Props) {
  const chart = useMemo(() => {
    if (samples.length === 0) return null;
    const hsM = samples.map((s) => s.hsM ?? 0);
    const vals = hsM.map((m) => metersToWave(m, waveUnit));
    const peak = Math.max(...vals, metersToWave(0.01, waveUnit));
    const floor = metersToWave(HS_COLOR_MAX_M * 0.5, waveUnit);
    const yMax = niceWaveMax(Math.max(peak, floor), waveUnit);

    const innerH = H - PAD.top - PAD.bottom;
    const n = samples.length;
    const axis = buildTimeAxis(n);
    const { barW, xBar, xCenter } = axis;
    const yAt = (v: number) => PAD.top + innerH * (1 - v / yMax);
    const baseline = PAD.top + innerH;

    const points = samples.map((s, i) => {
      const m = hsM[i]!;
      const v = vals[i]!;
      const [r, g, b] = hsColor(m, HS_COLOR_MAX_M, DEFAULT_WAVE_SCALE);
      return {
        i,
        x: xCenter(i),
        y: yAt(v),
        barX: xBar(i),
        selected: i === sampleIndex,
        fill: `rgb(${r},${g},${b})`,
        meters: m,
        missing: s.hsM == null,
      };
    });

    const line = points
      .filter((p) => !p.missing)
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ");

    const area =
      points.filter((p) => !p.missing).length > 1
        ? `${line} L${points[points.length - 1]!.x.toFixed(1)},${baseline} L${points[0]!.x.toFixed(1)},${baseline} Z`
        : "";

    const labelEvery = Math.max(1, Math.ceil(n / 8));
    const timeLabels = samples
      .map((s, i) => ({ i, x: xCenter(i), text: formatHourLabel(new Date(s.time)) }))
      .filter((l) => l.i === 0 || l.i === n - 1 || l.i % labelEvery === 0);

    const ticks = [0, yMax / 2, yMax];
    return {
      axis,
      points,
      barW,
      line,
      area,
      ticks,
      yAt,
      baseline,
      timeLabels,
      innerH,
      selected: formatWaveHeight(hsM[sampleIndex] ?? 0, waveUnit),
    };
  }, [samples, sampleIndex, waveUnit]);

  if (!chart) return null;

  return (
    <div className="session-wave-chart forecast-plot">
      <div className="forecast-plot-rail">
        <ColorScaleLegend
          orientation="vertical"
          gradient={scaleGradientCss(DEFAULT_WAVE_SCALE, "vertical")}
          labels={[
            waveScaleLabel(0, waveUnit),
            waveScaleLabel(HS_COLOR_MAX_M / 2, waveUnit),
            waveScaleLabel(HS_COLOR_MAX_M, waveUnit),
          ]}
          unit={waveUnitLabel(waveUnit)}
        />
        <span className="forecast-plot-title">Waves</span>
      </div>
      <svg
        className="wind-chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label="Wave height along the uploaded track during the session"
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
              className="wind-chart-tick hs"
              textAnchor="end"
            >
              {formatTick(v, waveUnit)}
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
        {chart.area && <path d={chart.area} className="session-wave-area" />}
        {chart.line && <path d={chart.line} className="session-wave-line" />}
        {chart.points.map((p) =>
          p.missing ? null : (
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
          ),
        )}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={chart.baseline}
          y2={chart.baseline}
          className="wind-chart-baseline"
        />
        {chart.timeLabels.map((l) => (
          <text
            key={`t-${l.i}`}
            x={l.x}
            y={H - 4}
            className="wind-chart-hour"
            textAnchor="middle"
          >
            {l.text}
          </text>
        ))}
      </svg>
    </div>
  );
}
