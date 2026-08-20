import { useMemo } from "react";
import { formatWind, nearestHourIndex, type WindHour } from "../lib/wind";
import { sliderInsetStyle } from "../lib/forecastChart";
import {
  celsiusToTemp,
  formatTemp,
  formatWaveHeight,
  metersToWave,
  mpsToWind,
  niceTempRange,
  niceWaveMax,
  niceWindMax,
  tempUnitLabel,
  type TempUnit,
  type WaveHeightUnit,
  type WindSpeedUnit,
  waveUnitLabel,
  windUnitLabel,
} from "../lib/units";
import { formatWeatherHour, isThunder } from "../lib/weather";
import { WindChart } from "./WindChart";
import { WaveChart } from "./WaveChart";
import { TempChart, hasTempHours } from "./TempChart";
import { WeatherStrip } from "./WeatherStrip";
import { ForecastTimeAxis } from "./ForecastTimeAxis";
import { ColorScaleLegend } from "./ColorScaleLegend";
import { compareChartTimes } from "../lib/compareLakes";
import {
  DEFAULT_TEMP_SCALE,
  DEFAULT_WAVE_SCALE,
  DEFAULT_WIND_SCALE,
  scaleGradientCss,
} from "../lib/colorScales";
import { WIND_COLOR_MAX_MPS } from "../lib/windScale";
import { HS_COLOR_MAX_M } from "../lib/hsOverlay";
import { TEMP_COLOR_MAX_C, TEMP_COLOR_MIN_C } from "../lib/tempScale";

function formatSelectedWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
  });
}

function formatHs(m: number | null | undefined, unit: WaveHeightUnit): string {
  if (m == null || !Number.isFinite(m)) return "—";
  return formatWaveHeight(m, unit);
}

function windLegendLabel(mps: number, unit: WindSpeedUnit): string {
  return mpsToWind(mps, unit).toFixed(unit === "mps" ? 1 : 0);
}

function waveLegendLabel(m: number, unit: WaveHeightUnit): string {
  const v = metersToWave(m, unit);
  return unit === "cm" ? v.toFixed(0) : v.toFixed(1);
}

export type CompareSeries = {
  id: string;
  name: string;
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

function localHourIndex(hours: WindHour[], selectedTime: string | undefined): number {
  if (!selectedTime || hours.length === 0) return 0;
  const exact = hours.findIndex((h) => h.time === selectedTime);
  if (exact >= 0) return exact;
  const t = Date.parse(selectedTime);
  return Number.isFinite(t) ? nearestHourIndex(hours, t) : 0;
}

export function CompareCharts({
  series,
  hourIndex,
  onSelectHour,
  windUnit,
  waveUnit,
  tempUnit,
}: Props) {
  const times = useMemo(() => compareChartTimes(series), [series]);
  const selectedTime = times[hourIndex];
  const nowIndex = nearestHourIndex(times.map((time) => ({ time })));
  const showTemp = series.some((s) => hasTempHours(s.hours));
  const sharedScale = useMemo(() => {
    let windMax = 0;
    let waveMaxM = 0.01;
    let tempMinC: number | null = null;
    let tempMaxC: number | null = null;
    for (const s of series) {
      for (const h of s.hours) {
        windMax = Math.max(windMax, mpsToWind(h.windSpeedMps, windUnit));
        if (h.gustMps != null && Number.isFinite(h.gustMps)) {
          windMax = Math.max(windMax, mpsToWind(h.gustMps, windUnit));
        }
        if (h.tempC != null && Number.isFinite(h.tempC)) {
          tempMinC = tempMinC == null ? h.tempC : Math.min(tempMinC, h.tempC);
          tempMaxC = tempMaxC == null ? h.tempC : Math.max(tempMaxC, h.tempC);
        }
      }
      for (const m of s.hsM) {
        if (m != null && Number.isFinite(m)) waveMaxM = Math.max(waveMaxM, m);
      }
    }
    const wavePeak = metersToWave(waveMaxM, waveUnit);
    const waveFloor = metersToWave(HS_COLOR_MAX_M * 0.5, waveUnit);
    const tempRange =
      tempMinC != null && tempMaxC != null
        ? niceTempRange(tempMinC, tempMaxC, tempUnit)
        : null;
    return {
      windYMax: niceWindMax(windMax, windUnit),
      waveYMax: niceWaveMax(Math.max(wavePeak, waveFloor), waveUnit),
      tempYMin: tempRange?.min,
      tempYMax: tempRange?.max,
    };
  }, [series, windUnit, waveUnit, tempUnit]);

  if (series.length === 0 || times.length === 0) return null;

  function selectFromLake(hours: WindHour[], localIndex: number) {
    const t = hours[localIndex]?.time;
    if (!t) return;
    const i = times.indexOf(t);
    onSelectHour(i >= 0 ? i : localIndex);
  }

  return (
    <div className="compare-charts">
      <div className="compare-scale-legends" aria-label="Shared color scales">
        <div className="compare-scale-legend">
          <span className="compare-scale-legend-title">Wind</span>
          <ColorScaleLegend
            gradient={scaleGradientCss(DEFAULT_WIND_SCALE)}
            labels={[
              windLegendLabel(0, windUnit),
              windLegendLabel(WIND_COLOR_MAX_MPS / 2, windUnit),
              windLegendLabel(WIND_COLOR_MAX_MPS, windUnit),
            ]}
            unit={windUnitLabel(windUnit)}
          />
        </div>
        <div className="compare-scale-legend">
          <span className="compare-scale-legend-title">Waves</span>
          <ColorScaleLegend
            gradient={scaleGradientCss(DEFAULT_WAVE_SCALE)}
            labels={[
              waveLegendLabel(0, waveUnit),
              waveLegendLabel(HS_COLOR_MAX_M / 2, waveUnit),
              waveLegendLabel(HS_COLOR_MAX_M, waveUnit),
            ]}
            unit={waveUnitLabel(waveUnit)}
          />
        </div>
        {showTemp && (
          <div className="compare-scale-legend">
            <span className="compare-scale-legend-title">Temp</span>
            <ColorScaleLegend
              gradient={scaleGradientCss(DEFAULT_TEMP_SCALE)}
              labels={[
                celsiusToTemp(TEMP_COLOR_MIN_C, tempUnit).toFixed(0),
                celsiusToTemp(
                  (TEMP_COLOR_MIN_C + TEMP_COLOR_MAX_C) / 2,
                  tempUnit,
                ).toFixed(0),
                celsiusToTemp(TEMP_COLOR_MAX_C, tempUnit).toFixed(0),
              ]}
              unit={tempUnitLabel(tempUnit)}
            />
          </div>
        )}
      </div>
      <div className="compare-lake-grid" data-count={series.length}>
        {series.map((s) => {
          const localIndex = localHourIndex(s.hours, selectedTime);
          const selectHour = (i: number) => selectFromLake(s.hours, i);
          const hour = s.hours[localIndex];
          const hsM = s.hsM[localIndex] ?? null;
          return (
            <section
              key={s.id}
              className="compare-lake-panel"
              aria-label={`${s.name} forecast`}
            >
              <h2 className="compare-lake-heading">{s.name}</h2>
              <p className="compare-lake-readout">
                {hour ? (
                  <>
                    <span>
                      {formatWind(
                        hour.windSpeedMps,
                        hour.windDirDeg,
                        hour.gustMps,
                        windUnit,
                      )}
                    </span>
                    <span>Hs {formatHs(hsM, waveUnit)}</span>
                    {hour.tempC != null && Number.isFinite(hour.tempC) && (
                      <span>{formatTemp(hour.tempC, tempUnit)}</span>
                    )}
                    <span
                      className={
                        isThunder(hour.weatherCode)
                          ? "wx-readout thunder"
                          : undefined
                      }
                    >
                      {formatWeatherHour(hour.weatherCode, hour.precipMm)}
                    </span>
                  </>
                ) : (
                  <span className="muted">No data at this hour</span>
                )}
              </p>
              <WindChart
                hours={s.hours}
                hourIndex={localIndex}
                onSelectHour={selectHour}
                windUnit={windUnit}
                compact
                yMax={sharedScale.windYMax}
              />
              <WaveChart
                hours={s.hours}
                hourIndex={localIndex}
                onSelectHour={selectHour}
                waveUnit={waveUnit}
                hsMSeries={s.hsM}
                compact
                yMax={sharedScale.waveYMax}
              />
              {hasTempHours(s.hours) && (
                <TempChart
                  hours={s.hours}
                  hourIndex={localIndex}
                  onSelectHour={selectHour}
                  tempUnit={tempUnit}
                  compact
                  yMin={sharedScale.tempYMin}
                  yMax={sharedScale.tempYMax}
                />
              )}
              <WeatherStrip
                hours={s.hours}
                hourIndex={localIndex}
                onSelectHour={selectHour}
                compact
              />
            </section>
          );
        })}
      </div>
      <div className="forecast-plot">
        <div className="forecast-plot-rail" aria-hidden />
        <ForecastTimeAxis
          times={times}
          hourIndex={hourIndex}
          onSelectHour={onSelectHour}
        />
      </div>
      <div className="forecast-plot compare-selected-time-row">
        <div className="forecast-plot-rail" aria-hidden />
        <p className="compare-selected-time" aria-live="polite">
          {times[hourIndex] ? formatSelectedWhen(times[hourIndex]!) : ""}
          {hourIndex === nowIndex ? " · Now" : ""}
        </p>
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
        <div className="scrubber" style={sliderInsetStyle(times.length)}>
          <input
            type="range"
            min={0}
            max={times.length - 1}
            step={1}
            value={Math.min(hourIndex, times.length - 1)}
            onChange={(e) => onSelectHour(Number(e.target.value))}
            aria-label="Forecast hour"
            aria-valuetext={
              times[hourIndex]
                ? `${formatSelectedWhen(times[hourIndex]!)}${hourIndex === nowIndex ? ", now" : ""}`
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
