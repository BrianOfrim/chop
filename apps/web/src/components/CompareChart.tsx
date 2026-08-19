import { useMemo } from "react";
import { nearestHourIndex, type WindHour } from "../lib/wind";
import {
  CHART_PAD,
  CHART_W,
  CHART_WIND_PAD,
  buildDaySegs,
  buildTimeAxis,
  sliderInsetStyle,
} from "../lib/forecastChart";
import {
  celsiusToTemp,
  metersToWave,
  mpsToWind,
  niceTempRange,
  niceWaveMax,
  niceWindMax,
  tempUnitLabel,
  waveUnitLabel,
  windUnitLabel,
  type TempUnit,
  type WaveHeightUnit,
  type WindSpeedUnit,
} from "../lib/units";
import { ForecastTimeAxis } from "./ForecastTimeAxis";
import { WxGlyph } from "./WeatherStrip";
import { compareChartTimes } from "../lib/compareLakes";
import {
  formatWeatherHour,
  isNightLocalTime,
  isThunder,
  weatherKind,
} from "../lib/weather";

export type CompareSeries = {
  id: string;
  name: string;
  color: string;
  hours: WindHour[];
  hsM: Array<number | null>;
};

type Props = {
  series: CompareSeries[];
  hourIndex: number;
  onSelectHour: (index: number) => void;
  windUnit: WindSpeedUnit;
  waveUnit: WaveHeightUnit;
  tempUnit: TempUnit;
};

const W = CHART_W;
const WIND_H = 92;
const WAVE_H = 78;
const TEMP_H = 78;
const WX_ROW = 18;
const PRECIP_BAR_MAX_MM = 4;
const PRECIP_BAR_H = 4;

function byTime<T>(times: string[], hours: WindHour[], values: T[]): Array<T | null> {
  const map = new Map<string, T>();
  hours.forEach((h, i) => {
    const v = values[i];
    if (v !== undefined) map.set(h.time, v);
  });
  return times.map((t) => map.get(t) ?? null);
}

function lineSegs(
  times: string[],
  values: Array<number | null>,
  xAt: (i: number) => number,
  yAt: (v: number) => number,
): string[] {
  const segs: string[] = [];
  let d = "";
  times.forEach((_, i) => {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) {
      if (d) {
        segs.push(d);
        d = "";
      }
      return;
    }
    const cmd = `${xAt(i).toFixed(2)} ${yAt(v).toFixed(2)}`;
    d += d ? ` L ${cmd}` : `M ${cmd}`;
  });
  if (d) segs.push(d);
  return segs;
}

function DirMark({
  x,
  y,
  toBearing,
  color,
}: {
  x: number;
  y: number;
  toBearing: number;
  color: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${toBearing})`}>
      <line x1="0" y1="5" x2="0" y2="-5" stroke={color} strokeWidth="1.4" />
      <polygon points="0,-6 2.4,-1.5 -2.4,-1.5" fill={color} />
    </g>
  );
}

function OverlayPlot({
  title,
  unit,
  times,
  hourIndex,
  onSelectHour,
  yMin = 0,
  yMax,
  tickDigits,
  height,
  padBottom,
  seriesLines,
  dirMarks,
}: {
  title: string;
  unit: string;
  times: string[];
  hourIndex: number;
  onSelectHour: (index: number) => void;
  yMin?: number;
  yMax: number;
  tickDigits: number;
  height: number;
  padBottom: number;
  seriesLines: Array<{ id: string; color: string; segs: string[] }>;
  dirMarks?: Array<{ id: string; color: string; toBearing: number }>;
}) {
  const pad = { ...CHART_PAD, bottom: padBottom };
  const innerH = height - pad.top - pad.bottom;
  const axis = buildTimeAxis(times.length);
  const span = yMax - yMin || 1;
  const yAt = (v: number) => pad.top + innerH * (1 - (v - yMin) / span);
  const ticks = [yMin, yMin + span / 2, yMax];
  const daySegs = buildDaySegs(times);
  const dayDividers = daySegs.slice(1).map((seg) => pad.left + seg.start * axis.slot);
  const selectedX = axis.xBar(hourIndex);
  const dirY = height - pad.bottom / 2;

  return (
    <div className="forecast-plot compare-plot">
      <div className="forecast-plot-rail">
        <span className="forecast-plot-title">{title}</span>
        <span className="forecast-plot-unit">{unit}</span>
      </div>
      <svg
        className="wind-chart-svg"
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label={`${title} forecast comparison`}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onSelectHour(
            axis.indexFromClientX(e.clientX - rect.left, rect.width, times.length),
          );
        }}
      >
        {dayDividers.map((x) => (
          <line
            key={`div-${x}`}
            x1={x}
            x2={x}
            y1={4}
            y2={height - 2}
            className="wind-chart-day-div"
          />
        ))}
        {ticks.map((v) => (
          <g key={`tick-${v}`}>
            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={yAt(v)}
              y2={yAt(v)}
              className="wind-chart-grid"
            />
            <text
              x={pad.left - 4}
              y={yAt(v) + 3}
              className="wind-chart-tick"
              textAnchor="end"
            >
              {v.toFixed(tickDigits)}
            </text>
          </g>
        ))}
        {times.length > 0 && (
          <rect
            x={selectedX - 0.6}
            y={pad.top}
            width={axis.barW + 1.2}
            height={innerH}
            className="wind-chart-selection"
          />
        )}
        {seriesLines.map((s) =>
          s.segs.map((d, i) => (
            <g key={`${s.id}-${i}`}>
              <path
                d={d}
                fill="none"
                stroke="rgba(248, 246, 240, 0.9)"
                strokeWidth="3.8"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth="2.4"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          )),
        )}
        {dirMarks?.map((m, i) => (
          <DirMark
            key={m.id}
            x={axis.xCenter(hourIndex) + (i - (dirMarks.length - 1) / 2) * 8}
            y={dirY}
            toBearing={m.toBearing}
            color={m.color}
          />
        ))}
      </svg>
    </div>
  );
}

export function CompareCharts({
  series,
  hourIndex,
  onSelectHour,
  windUnit,
  waveUnit,
  tempUnit,
}: Props) {
  const chart = useMemo(() => {
    if (series.length === 0) return null;
    const times = compareChartTimes(series);
    if (times.length === 0) return null;
    const axis = buildTimeAxis(times.length);
    const xAt = (i: number) => axis.xCenter(i);

    const windVals = series.map((s) =>
      byTime(
        times,
        s.hours,
        s.hours.map((h) => mpsToWind(h.windSpeedMps, windUnit)),
      ),
    );
    const hsVals = series.map((s) =>
      byTime(
        times,
        s.hours,
        s.hsM.map((m) => (m == null ? null : metersToWave(m, waveUnit))),
      ),
    );
    const tempCVals = series.map((s) =>
      byTime(
        times,
        s.hours,
        s.hours.map((h) =>
          h.tempC != null && Number.isFinite(h.tempC) ? h.tempC : null,
        ),
      ),
    );
    const tempVals = tempCVals.map((vals) =>
      vals.map((c) => (c == null ? null : celsiusToTemp(c, tempUnit))),
    );

    const windPeak = Math.max(
      0.01,
      ...windVals.flatMap((vals) => vals.filter((v): v is number => v != null)),
    );
    const hsPeak = Math.max(
      0.01,
      ...hsVals.flatMap((vals) => vals.filter((v): v is number => v != null)),
    );
    const tempKnownC = tempCVals.flatMap((vals) =>
      vals.filter((v): v is number => v != null),
    );
    const windMax = niceWindMax(windPeak, windUnit);
    const waveMax = niceWaveMax(hsPeak, waveUnit);
    const tempRange =
      tempKnownC.length > 0
        ? niceTempRange(Math.min(...tempKnownC), Math.max(...tempKnownC), tempUnit)
        : null;
    const windInnerH = WIND_H - CHART_WIND_PAD.top - CHART_WIND_PAD.bottom;
    const waveInnerH = WAVE_H - CHART_PAD.top - CHART_PAD.bottom;
    const windY = (v: number) =>
      CHART_WIND_PAD.top + windInnerH * (1 - v / windMax);
    const waveY = (v: number) => CHART_PAD.top + waveInnerH * (1 - v / waveMax);
    const tempSpan = tempRange ? tempRange.max - tempRange.min || 1 : 1;
    const tempInnerH = TEMP_H - CHART_PAD.top - CHART_PAD.bottom;
    const tempY = (v: number) =>
      CHART_PAD.top + tempInnerH * (1 - (v - (tempRange?.min ?? 0)) / tempSpan);

    const windLines = series.map((s, i) => ({
      id: s.id,
      color: s.color,
      segs: lineSegs(times, windVals[i]!, xAt, windY),
    }));
    const waveLines = series.map((s, i) => ({
      id: s.id,
      color: s.color,
      segs: lineSegs(times, hsVals[i]!, xAt, waveY),
    }));
    const tempLines = tempRange
      ? series.map((s, i) => ({
          id: s.id,
          color: s.color,
          segs: lineSegs(times, tempVals[i]!, xAt, tempY),
        }))
      : [];

    const selectedTime = times[hourIndex];
    const dirMarks = series.flatMap((s) => {
      const h = s.hours.find((hr) => hr.time === selectedTime);
      if (!h) return [];
      return [{ id: s.id, color: s.color, toBearing: (h.windDirDeg + 180) % 360 }];
    });

    return {
      times,
      windMax,
      waveMax,
      tempRange,
      windLines,
      waveLines,
      tempLines,
      dirMarks,
      windDigits: windUnit === "mps" ? 1 : 0,
      waveDigits: waveUnit === "m" ? 2 : waveUnit === "ft" ? 1 : 0,
    };
  }, [series, hourIndex, windUnit, waveUnit, tempUnit]);

  if (!chart) return null;

  const nowIndex = nearestHourIndex(chart.times.map((time) => ({ time })));

  return (
    <div className="compare-charts">
      <OverlayPlot
        title="Wind"
        unit={windUnitLabel(windUnit)}
        times={chart.times}
        hourIndex={hourIndex}
        onSelectHour={onSelectHour}
        yMax={chart.windMax}
        tickDigits={chart.windDigits}
        height={WIND_H}
        padBottom={CHART_WIND_PAD.bottom}
        seriesLines={chart.windLines}
        dirMarks={chart.dirMarks}
      />
      <OverlayPlot
        title="Waves"
        unit={waveUnitLabel(waveUnit)}
        times={chart.times}
        hourIndex={hourIndex}
        onSelectHour={onSelectHour}
        yMax={chart.waveMax}
        tickDigits={chart.waveDigits}
        height={WAVE_H}
        padBottom={CHART_PAD.bottom}
        seriesLines={chart.waveLines}
      />
      {chart.tempRange && (
        <OverlayPlot
          title="Temp"
          unit={tempUnitLabel(tempUnit)}
          times={chart.times}
          hourIndex={hourIndex}
          onSelectHour={onSelectHour}
          yMin={chart.tempRange.min}
          yMax={chart.tempRange.max}
          tickDigits={0}
          height={TEMP_H}
          padBottom={CHART_PAD.bottom}
          seriesLines={chart.tempLines}
        />
      )}
      <CompareWeather
        series={series}
        times={chart.times}
        hourIndex={hourIndex}
        onSelectHour={onSelectHour}
      />
      <div className="forecast-plot">
        <div className="forecast-plot-rail" aria-hidden />
        <ForecastTimeAxis
          times={chart.times}
          hourIndex={hourIndex}
          onSelectHour={onSelectHour}
        />
      </div>
      <div className="forecast-plot scrubber-row">
        <div className="forecast-plot-rail scrubber-rail">
          <button
            type="button"
            className="now-btn"
            disabled={hourIndex === nowIndex}
            onClick={() => onSelectHour(nowIndex)}
          >
            Now
          </button>
        </div>
        <div className="scrubber" style={sliderInsetStyle(chart.times.length)}>
          <input
            type="range"
            min={0}
            max={chart.times.length - 1}
            step={1}
            value={Math.min(hourIndex, chart.times.length - 1)}
            onChange={(e) => onSelectHour(Number(e.target.value))}
            aria-label="Forecast hour"
          />
        </div>
      </div>
    </div>
  );
}

function CompareWeather({
  series,
  times,
  hourIndex,
  onSelectHour,
}: {
  series: CompareSeries[];
  times: string[];
  hourIndex: number;
  onSelectHour: (index: number) => void;
}) {
  const chart = useMemo(() => {
    if (times.length === 0 || series.length === 0) return null;
    const axis = buildTimeAxis(times.length);
    const daySegs = buildDaySegs(times);
    const dayDividers = daySegs
      .slice(1)
      .map((seg) => CHART_PAD.left + seg.start * axis.slot);
    const iconSize = Math.max(5.2, Math.min(10, axis.barW * 1.15));
    const height = 6 + series.length * WX_ROW;
    const rows = series.map((s, row) => {
      const byT = new Map(s.hours.map((h) => [h.time, h]));
      const y0 = 4 + row * WX_ROW;
      const cells = times.map((time, i) => {
        const h = byT.get(time);
        const precip = h?.precipMm ?? 0;
        const wet = precip >= 0.05;
        return {
          i,
          x: axis.xBar(i),
          cx: axis.xCenter(i),
          kind: weatherKind(h?.weatherCode ?? null),
          thunder: isThunder(h?.weatherCode),
          night: isNightLocalTime(time),
          precip,
          wet,
          barH: wet
            ? Math.max(
                1,
                Math.min(PRECIP_BAR_H, (precip / PRECIP_BAR_MAX_MM) * PRECIP_BAR_H),
              )
            : 0,
          title: h ? formatWeatherHour(h.weatherCode, precip) : "—",
        };
      });
      return { id: s.id, color: s.color, y0, cells };
    });
    return { axis, dayDividers, iconSize, height, rows };
  }, [series, times]);

  if (!chart) return null;
  const selectedX = chart.axis.xBar(hourIndex);

  return (
    <div className="forecast-plot compare-plot">
      <div className="forecast-plot-rail">
        <span className="forecast-plot-title">Sky</span>
      </div>
      <svg
        className="wind-chart-svg"
        viewBox={`0 0 ${W} ${chart.height}`}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label="Weather and precipitation comparison"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onSelectHour(
            chart.axis.indexFromClientX(
              e.clientX - rect.left,
              rect.width,
              times.length,
            ),
          );
        }}
      >
        {chart.dayDividers.map((x) => (
          <line
            key={`div-${x}`}
            x1={x}
            x2={x}
            y1={2}
            y2={chart.height - 2}
            className="wind-chart-day-div"
          />
        ))}
        {times.length > 0 && (
          <rect
            x={selectedX - 0.6}
            y={2}
            width={chart.axis.barW + 1.2}
            height={chart.height - 4}
            className="wind-chart-selection"
          />
        )}
        {chart.rows.map((row) => (
          <g key={row.id}>
            <rect
              x={CHART_PAD.left - 10}
              y={row.y0 + 3}
              width="5"
              height={WX_ROW - 8}
              rx="1"
              fill={row.color}
            />
            {row.cells.map((c) => (
              <g key={c.i}>
                <title>{c.title}</title>
                <g
                  transform={`translate(${c.cx.toFixed(1)},${(row.y0 + 8).toFixed(1)}) scale(${(chart.iconSize / 12).toFixed(3)})`}
                >
                  <WxGlyph
                    kind={c.kind}
                    thunder={c.thunder}
                    night={c.night}
                  />
                </g>
                {c.wet && (
                  <rect
                    x={c.x}
                    y={row.y0 + WX_ROW - 3 - c.barH}
                    width={chart.axis.barW}
                    height={c.barH}
                    fill={row.color}
                    opacity="0.55"
                    rx={0.4}
                  />
                )}
              </g>
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}
