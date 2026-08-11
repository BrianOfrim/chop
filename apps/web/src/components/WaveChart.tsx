import { useMemo } from "react";
import { computeHsGrid, type LakeGrids } from "@chop/wave-engine";
import { hsColor, HS_COLOR_MAX_M } from "../lib/hsOverlay";
import type { WindHour } from "../lib/wind";
import {
  CHART_PAD,
  CHART_W,
  buildDaySegs,
  buildHourLabels,
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

type Props = {
  hours: WindHour[];
  hourIndex: number;
  onSelectHour: (index: number) => void;
  grids: LakeGrids;
  waveUnit: WaveHeightUnit;
};

const W = CHART_W;
const H = 148;
const PAD = { ...CHART_PAD, bottom: 36 };
const BAR_GAP = 1.4;

function maxHsM(hs: Float32Array): number {
  let m = 0;
  for (let i = 0; i < hs.length; i++) {
    const v = hs[i]!;
    if (Number.isFinite(v) && v > m) m = v;
  }
  return m;
}

function formatTick(v: number, unit: WaveHeightUnit): string {
  if (unit === "m") return v.toFixed(1);
  if (unit === "ft") return v.toFixed(1);
  return v.toFixed(0);
}

function waveScaleLabel(m: number, unit: WaveHeightUnit): string {
  return formatTick(metersToWave(m, unit), unit);
}

export function WaveChart({
  hours,
  hourIndex,
  onSelectHour,
  grids,
  waveUnit,
}: Props) {
  const maxHsMSeries = useMemo(
    () =>
      hours.map((h) =>
        maxHsM(computeHsGrid(grids, h.windSpeedMps, h.windDirDeg)),
      ),
    [grids, hours],
  );

  const chart = useMemo(() => {
    if (hours.length === 0) return null;
    const vals = maxHsMSeries.map((m) => metersToWave(m, waveUnit));
    const peak = Math.max(...vals, metersToWave(0.01, waveUnit));
    const floor = metersToWave(HS_COLOR_MAX_M * 0.5, waveUnit);
    const yMax = niceWaveMax(Math.max(peak, floor), waveUnit);

    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const n = hours.length;
    const slot = innerW / n;
    const barW = Math.max(1.8, slot - BAR_GAP);
    const yAt = (v: number) => PAD.top + innerH * (1 - v / yMax);
    const baseline = PAD.top + innerH;
    const xBar = (i: number) => PAD.left + i * slot + (slot - barW) / 2;

    const bars = maxHsMSeries.map((m, i) => {
      const v = vals[i]!;
      const top = yAt(v);
      const [r, g, b, a] = hsColor(m, HS_COLOR_MAX_M, DEFAULT_WAVE_SCALE);
      return {
        i,
        x: xBar(i),
        top,
        h: Math.max(0, baseline - top),
        meters: m,
        selected: i === hourIndex,
        fill: `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`,
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
    const selectedM = bars[hourIndex]?.meters ?? null;

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
      selectedM,
      unitLabel: waveUnitLabel(waveUnit),
      gradient: scaleGradientCss(DEFAULT_WAVE_SCALE),
    };
  }, [hours, hourIndex, maxHsMSeries, waveUnit]);

  if (!chart) return null;

  return (
    <div className="wave-chart">
      <div className="wind-chart-header">
        <span className="wind-chart-title">
          Waves
          {chart.selectedM != null && (
            <span className="wind-chart-hs-readout">
              {" "}
              · max Hs {formatWaveHeight(chart.selectedM, waveUnit)}
            </span>
          )}
        </span>
        <span className="wind-chart-legend">
          <ColorScaleLegend
            gradient={chart.gradient}
            labels={[
              waveScaleLabel(0, waveUnit),
              waveScaleLabel(HS_COLOR_MAX_M / 2, waveUnit),
              waveScaleLabel(HS_COLOR_MAX_M, waveUnit),
            ]}
            unit={waveUnitLabel(waveUnit)}
          />
        </span>
      </div>
      <svg
        className="wind-chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Maximum lake wave height over the forecast period"
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
        <text
          x={10}
          y={PAD.top - 8}
          className="wind-chart-axis-label hs"
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
          <rect
            key={b.i}
            x={b.x}
            y={b.top}
            width={chart.barW}
            height={b.h}
            fill={b.fill}
            className={b.selected ? "wave-chart-bar selected" : "wave-chart-bar"}
            rx={0.6}
          />
        ))}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={chart.baseline}
          y2={chart.baseline}
          className="wind-chart-baseline"
        />
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
