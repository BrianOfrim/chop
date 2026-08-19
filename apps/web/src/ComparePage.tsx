import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Topbar } from "./components/Topbar";
import { CompareCharts, type CompareSeries } from "./components/CompareChart";
import {
  applyCompareRange,
  compareColor,
  COMPARE_SORT_OPTIONS,
  loadCompareForecasts,
  loadCompareMetas,
  loadEnabledLakes,
  loadSelectedCompareLakes,
  loadingRows,
  MAX_COMPARE_LAKES,
  saveSelectedCompareLakes,
  sortCompareRows,
  toggleSelectedLake,
  compareChartTimes,
  type CompareSort,
  type LakeCompareRow,
} from "./lib/compareLakes";
import {
  FORECAST_RANGE_OPTIONS,
  loadForecastRange,
  remapHourIndex,
  saveForecastRange,
  type ForecastRangeHours,
} from "./lib/forecastRange";
import {
  DEFAULT_UNITS,
  formatTemp,
  formatWaveHeight,
  formatWindSpeed,
  loadUnitPrefs,
  saveUnitPrefs,
  type UnitPrefs,
} from "./lib/units";
import { cardinalFromDeg, formatWind, nearestHourIndex } from "./lib/wind";
import { formatWeatherHour, isThunder } from "./lib/weather";
import { loadLakeId, saveLakeId } from "./lib/selectedLake";
import { setAppView } from "./lib/view";
import "./App.css";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
  });
}

function formatHs(m: number | null | undefined, unit: UnitPrefs["wave"]): string {
  if (m == null || !Number.isFinite(m)) return "—";
  return formatWaveHeight(m, unit);
}

function formatWindNow(
  speedMps: number | undefined,
  dirDeg: number | undefined,
  unit: UnitPrefs["wind"],
): string {
  if (speedMps == null || dirDeg == null) return "—";
  return `${formatWindSpeed(speedMps, unit)} ${cardinalFromDeg(dirDeg)}`;
}

function formatTempNow(
  tempC: number | null | undefined,
  unit: UnitPrefs["temp"],
): string {
  if (tempC == null || !Number.isFinite(tempC)) return "—";
  return formatTemp(tempC, unit);
}

function formatConditions(
  weatherCode: number | null | undefined,
  precipMm: number | undefined,
): string {
  return formatWeatherHour(weatherCode, precipMm ?? 0);
}

export function ComparePage() {
  const [units, setUnits] = useState<UnitPrefs>(() =>
    typeof window !== "undefined" ? loadUnitPrefs() : { ...DEFAULT_UNITS },
  );
  const [forecastRange, setForecastRange] = useState<ForecastRangeHours>(() =>
    typeof window !== "undefined" ? loadForecastRange() : 72,
  );
  const [sort, setSort] = useState<CompareSort>("peakHs");
  const [rows, setRows] = useState<LakeCompareRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>(() =>
    typeof window !== "undefined"
      ? loadSelectedCompareLakes(loadLakeId())
      : [],
  );
  const [hourIndex, setHourIndex] = useState(0);
  const hadChartTimes = useRef(false);

  function updateUnits(patch: Partial<UnitPrefs>) {
    setUnits((prev) => {
      const next = { ...prev, ...patch };
      saveUnitPrefs(next);
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const lakes = await loadEnabledLakes();
        if (cancelled) return;
        const metas = await loadCompareMetas(lakes);
        if (cancelled) return;
        setRows(loadingRows(metas));
        setLoading(false);
        setSelected((prev) => {
          const enabled = new Set(metas.map((m) => m.id));
          const kept = prev.filter((id) => enabled.has(id));
          const fallback = metas[0]?.id;
          const next = kept.length > 0 ? kept : fallback ? [fallback] : [];
          saveSelectedCompareLakes(next);
          return next;
        });
        await loadCompareForecasts(
          metas,
          72,
          (row) => {
            if (cancelled) return;
            setRows((prev) => {
              const i = prev.findIndex((r) => r.meta.id === row.meta.id);
              if (i < 0) return [...prev, row];
              const next = prev.slice();
              next[i] = row;
              return next;
            });
          },
          () => cancelled,
        );
      } catch (e) {
        if (!cancelled) {
          setLoadError(String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const viewed = useMemo(
    () => rows.map((row) => applyCompareRange(row, forecastRange)),
    [rows, forecastRange],
  );
  const ranked = useMemo(
    () => sortCompareRows(viewed, sort),
    [viewed, sort],
  );
  const colorById = useMemo(() => {
    const map = new Map<string, string>();
    selected.forEach((id, i) => map.set(id, compareColor(i)));
    return map;
  }, [selected]);

  const chartSeries: CompareSeries[] = useMemo(
    () =>
      selected.flatMap((id) => {
        const row = viewed.find((r) => r.meta.id === id);
        if (!row || row.status !== "ready") return [];
        return [
          {
            id: row.meta.id,
            name: row.meta.name,
            color: colorById.get(id) ?? compareColor(0),
            hours: row.hours,
            hsM: row.hsM,
          },
        ];
      }),
    [selected, viewed, colorById],
  );

  const chartTimes = useMemo(
    () => compareChartTimes(chartSeries),
    [chartSeries],
  );

  useEffect(() => {
    if (chartTimes.length === 0) {
      hadChartTimes.current = false;
      setHourIndex(0);
      return;
    }
    if (!hadChartTimes.current) {
      hadChartTimes.current = true;
      setHourIndex(nearestHourIndex(chartTimes.map((time) => ({ time }))));
      return;
    }
    setHourIndex((prev) => Math.min(prev, chartTimes.length - 1));
  }, [chartTimes]);

  function updateForecastRange(next: ForecastRangeHours) {
    if (next === forecastRange) return;
    const prevHours = chartTimes.map((time) => ({ time }));
    saveForecastRange(next);
    setForecastRange(next);
    const nextViewed = rows.map((row) => applyCompareRange(row, next));
    const nextSeries = selected.flatMap((id) => {
      const row = nextViewed.find((r) => r.meta.id === id);
      if (!row || row.status !== "ready") return [];
      return [{ hours: row.hours }];
    });
    const nextTimes = [
      ...new Set(nextSeries.flatMap((s) => s.hours.map((h) => h.time))),
    ].sort();
    setHourIndex(
      remapHourIndex(prevHours, hourIndex, nextTimes.map((time) => ({ time }))),
    );
  }

  function onToggleLake(id: string) {
    setSelected((prev) => {
      const next = toggleSelectedLake(prev, id);
      saveSelectedCompareLakes(next);
      return next;
    });
  }

  function openOnMap(id: string) {
    saveLakeId(id);
    setAppView("map");
  }

  const readyCount = viewed.filter((r) => r.status === "ready").length;
  const selectedTime = chartTimes[Math.min(hourIndex, Math.max(0, chartTimes.length - 1))];

  return (
    <div className="app compare-app">
      <Topbar view="compare" units={units} onUnits={updateUnits} />
      <main className="compare-main">
        {loadError && <div className="compare-banner error">{loadError}</div>}
        <div className="compare-toolbar">
          <p className="compare-status">
            {loading
              ? "Loading lakes…"
              : `${readyCount} / ${viewed.length} forecasts`}
            <span className="muted">
              {" "}
              · select up to {MAX_COMPARE_LAKES} for charts
            </span>
          </p>
          <div className="compare-toolbar-controls">
            <div className="range-toggle" role="group" aria-label="Sort">
              {COMPARE_SORT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={sort === o.value ? "is-on" : undefined}
                  onClick={() => setSort(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div className="range-toggle" role="group" aria-label="Forecast range">
              {FORECAST_RANGE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={forecastRange === o.value ? "is-on" : undefined}
                  onClick={() => updateForecastRange(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <section className="compare-chart-panel" aria-label="Selected lake forecasts">
          {chartSeries.length === 0 ? (
            <p className="compare-chart-empty muted">
              Select lakes in the table to overlay wind, wave, temperature, and sky.
            </p>
          ) : (
            <>
              <div className="compare-readouts" aria-label="Values at selected hour">
                {chartSeries.map((s) => {
                  const i = selectedTime
                    ? s.hours.findIndex((h) => h.time === selectedTime)
                    : -1;
                  const hour = i >= 0 ? s.hours[i] : null;
                  const hsM = i >= 0 ? (s.hsM[i] ?? null) : null;
                  return (
                    <div key={s.id} className="compare-readout">
                      <span className="compare-readout-name">
                        <span
                          className="compare-swatch"
                          style={{ background: s.color }}
                        />
                        {s.name}
                      </span>
                      {hour ? (
                        <span className="readout">
                          <span>
                            {formatWind(
                              hour.windSpeedMps,
                              hour.windDirDeg,
                              hour.gustMps,
                              units.wind,
                            )}
                          </span>
                          <span>max Hs {formatHs(hsM, units.wave)}</span>
                          {hour.tempC != null && Number.isFinite(hour.tempC) && (
                            <span>{formatTemp(hour.tempC, units.temp)}</span>
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
                        </span>
                      ) : (
                        <span className="muted">No data at this hour</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <CompareCharts
                series={chartSeries}
                hourIndex={Math.min(hourIndex, Math.max(0, chartTimes.length - 1))}
                onSelectHour={setHourIndex}
                windUnit={units.wind}
                waveUnit={units.wave}
                tempUnit={units.temp}
              />
            </>
          )}
        </section>

        <div className="compare-table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th className="compare-check-col">
                  <span className="visually-hidden">Compare</span>
                </th>
                <th>Lake</th>
                <th>Now wind</th>
                <th>Now Hs</th>
                <th>Now temp</th>
                <th>Conditions</th>
                <th>Peak Hs</th>
                <th>Peak wind</th>
                <th>
                  <span className="visually-hidden">Open on map</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((row) => {
                const on = selected.includes(row.meta.id);
                const color = colorById.get(row.meta.id);
                const disabled =
                  row.status !== "ready" ||
                  (!on && selected.length >= MAX_COMPARE_LAKES);
                return (
                  <tr
                    key={row.meta.id}
                    className={on ? "is-selected" : undefined}
                    style={
                      on && color
                        ? ({ "--compare-color": color } as CSSProperties)
                        : undefined
                    }
                  >
                    <td className="compare-check-col">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={disabled}
                        aria-label={`Compare ${row.meta.name}`}
                        onChange={() => onToggleLake(row.meta.id)}
                      />
                    </td>
                    <td className="compare-name">{row.meta.name}</td>
                    <td>
                      {row.status === "loading"
                        ? "…"
                        : row.status === "error"
                          ? "unavailable"
                          : formatWindNow(
                              row.now?.windSpeedMps,
                              row.now?.windDirDeg,
                              units.wind,
                            )}
                    </td>
                    <td>{row.status === "ready" ? formatHs(row.now?.hsM, units.wave) : "—"}</td>
                    <td>
                      {row.status === "ready"
                        ? formatTempNow(row.now?.tempC, units.temp)
                        : "—"}
                    </td>
                    <td className="compare-conditions">
                      {row.status === "ready"
                        ? formatConditions(row.now?.weatherCode, row.now?.precipMm)
                        : "—"}
                    </td>
                    <td>
                      {row.status === "ready" ? (
                        <>
                          {formatHs(row.peakHs?.hsM, units.wave)}
                          {row.peakHs && (
                            <span className="muted"> {formatWhen(row.peakHs.time)}</span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {row.status === "ready" ? (
                        <>
                          {formatWindNow(
                            row.peakWind?.windSpeedMps,
                            row.peakWind?.windDirDeg,
                            units.wind,
                          )}
                          {row.peakWind && (
                            <span className="muted"> {formatWhen(row.peakWind.time)}</span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="gpx-btn"
                        onClick={() => openOnMap(row.meta.id)}
                      >
                        Map
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
