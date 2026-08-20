import { useMemo } from "react";
import {
  approxMaxHs,
  computeHsGrid,
  hsAtLonLat,
  windDurationSec,
  type LakeGrids,
} from "@chop/wave-engine";
import { hsColor, HS_COLOR_MAX_M } from "../lib/hsOverlay";
import type { WindHour } from "../lib/wind";
import {
  CHART_PAD,
  CHART_W,
  buildDaySegs,
  buildTimeAxis,
} from "../lib/forecastChart";
import {
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

export type ForecastPoint = { lon: number; lat: number };

type Props = {
  hours: WindHour[];
  hourIndex: number;
  onSelectHour: (index: number) => void;
  waveUnit: WaveHeightUnit;
  grids?: LakeGrids | null;
  sampleAt?: ForecastPoint | null;
  /** Precomputed max Hs (m) per hour; skips grid sampling when set. */
  hsMSeries?: Array<number | null>;
  /** Hide the per-plot color ramp; stretch the series to the plot width. */
  compact?: boolean;
  /** Shared axis ceiling in the active wave unit. */
  yMax?: number;
};

const W = CHART_W;
const H = 78;
const PAD = CHART_PAD;

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
  grids = null,
  waveUnit,
  sampleAt = null,
  hsMSeries: hsMSeriesProp,
  compact = false,
  yMax: yMaxProp,
}: Props) {
  const hsMSeries = useMemo(() => {
    if (hsMSeriesProp) {
      return hsMSeriesProp.map((m) => (m != null && Number.isFinite(m) ? m : 0));
    }
    if (!grids) return hours.map(() => 0);
    return hours.map((h, i) => {
      const durationSec = windDurationSec(hours, i);
      if (sampleAt) {
        return (
          hsAtLonLat(
            grids,
            sampleAt.lon,
            sampleAt.lat,
            h.windSpeedMps,
            h.windDirDeg,
            durationSec,
          ) ?? 0
        );
      }
      if (grids.waveStats) {
        return approxMaxHs(
          h.windSpeedMps,
          h.windDirDeg,
          grids.waveStats,
          durationSec,
        );
      }
      const hs = computeHsGrid(grids, h.windSpeedMps, h.windDirDeg, durationSec);
      return maxHsM(hs);
    });
  }, [grids, hours, sampleAt, hsMSeriesProp]);

  const chart = useMemo(() => {
    if (hours.length === 0) return null;
    const vals = hsMSeries.map((m) => metersToWave(m, waveUnit));
    const peak = Math.max(...vals, metersToWave(0.01, waveUnit));
    const floor = metersToWave(HS_COLOR_MAX_M * 0.5, waveUnit);
    const yMax = yMaxProp ?? niceWaveMax(Math.max(peak, floor), waveUnit);

    const innerH = H - PAD.top - PAD.bottom;
    const n = hours.length;
    const axis = buildTimeAxis(n);
    const { slot, barW, xBar } = axis;
    const yAt = (v: number) => PAD.top + innerH * (1 - v / yMax);
    const baseline = PAD.top + innerH;

    const bars = hsMSeries.map((m, i) => {
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
    const daySegs = buildDaySegs(times);
    const dayDividers = daySegs.slice(1).map((seg) => PAD.left + seg.start * slot);

    return {
      axis,
      bars,
      barW,
      ticks,
      yAt,
      baseline,
      dayDividers,
      innerH,
    };
  }, [hours, hourIndex, hsMSeries, waveUnit, yMaxProp]);

  if (!chart) return null;

  return (
    <div className="wave-chart forecast-plot">
      <div className="forecast-plot-rail">
        {!compact && (
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
        )}
        <span className="forecast-plot-title">Waves</span>
      </div>
      <svg
        className="wind-chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio={compact ? "none" : "xMinYMid meet"}
        role="img"
        aria-label={
          sampleAt
            ? "Wave height at the pinned lake point over the forecast period"
            : "Maximum lake wave height over the forecast period"
        }
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
              {formatTick(v, waveUnit)}
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
      </svg>
    </div>
  );
}
