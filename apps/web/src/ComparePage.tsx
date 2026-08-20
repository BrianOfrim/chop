import { useEffect, useMemo, useRef, useState } from "react";
import { Topbar } from "./components/Topbar";
import { CompareCharts, type CompareSeries } from "./components/CompareChart";
import {
  applyCompareRange,
  loadCompareForecasts,
  loadCompareMetas,
  loadEnabledLakes,
  loadSelectedCompareLakes,
  loadingRows,
  MAX_COMPARE_LAKES,
  promoteSelectedLake,
  saveSelectedCompareLakes,
  sortCompareRows,
  snapshotAtTime,
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
import { cardinalFromDeg, nearestHourIndex } from "./lib/wind";
import { formatWeatherHour } from "./lib/weather";
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

function formatSelectedWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
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

function SortTh({
  label,
  value,
  sort,
  onSort,
  className,
}: {
  label: string;
  value: CompareSort;
  sort: CompareSort;
  onSort: (value: CompareSort) => void;
  className?: string;
}) {
  const active = sort === value;
  return (
    <th
      className={[className, active ? "is-sorted" : undefined]
        .filter(Boolean)
        .join(" ")}
      aria-sort={active ? "descending" : "none"}
    >
      <button type="button" onClick={() => onSort(value)}>
        {label}
        {active && (
          <span className="compare-sort-mark" aria-hidden>
            ▾
          </span>
        )}
      </button>
    </th>
  );
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
          const mapId = loadLakeId();
          const fallback = enabled.has(mapId) ? mapId : metas[0]?.id;
          const next = kept.length > 0
            ? promoteSelectedLake(kept, fallback ?? "")
            : fallback
              ? [fallback]
              : [];
          saveSelectedCompareLakes(next);
          if (next[0]) saveLakeId(next[0]);
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
  const chartSeries: CompareSeries[] = useMemo(
    () =>
      selected.flatMap((id) => {
        const row = viewed.find((r) => r.meta.id === id);
        if (!row || row.status !== "ready") return [];
        return [
          {
            id: row.meta.id,
            name: row.meta.name,
            hours: row.hours,
            hsM: row.hsM,
          },
        ];
      }),
    [selected, viewed],
  );

  const chartTimes = useMemo(
    () => compareChartTimes(chartSeries),
    [chartSeries],
  );
  const selectedTime =
    chartTimes.length > 0
      ? chartTimes[Math.min(hourIndex, chartTimes.length - 1)]
      : undefined;
  const ranked = useMemo(
    () => sortCompareRows(viewed, sort, selectedTime),
    [viewed, sort, selectedTime],
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
      const toggled = toggleSelectedLake(prev, id);
      const next = toggled.includes(id)
        ? promoteSelectedLake(toggled, id)
        : toggled;
      saveSelectedCompareLakes(next);
      if (next[0]) saveLakeId(next[0]);
      return next;
    });
  }

  function openOnMap(id: string) {
    saveLakeId(id);
    setAppView("map");
  }

  const readyCount = viewed.filter((r) => r.status === "ready").length;

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
              Select lakes in the table to compare wind, wave, temperature, and sky.
            </p>
          ) : (
            <CompareCharts
              series={chartSeries}
              hourIndex={Math.min(hourIndex, Math.max(0, chartTimes.length - 1))}
              onSelectHour={setHourIndex}
              windUnit={units.wind}
              waveUnit={units.wave}
              tempUnit={units.temp}
            />
          )}
        </section>

        <div className="compare-table-wrap">
          <table className="compare-table">
            <colgroup>
              <col className="compare-col-check" />
              <col className="compare-col-lake" />
              <col className="compare-col-wind" />
              <col className="compare-col-hs" />
              <col className="compare-col-temp" />
              <col className="compare-col-wx" />
              <col className="compare-col-peak-hs" />
              <col className="compare-col-peak-wind" />
              <col className="compare-col-map" />
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} className="compare-check-col">
                  <span className="visually-hidden">Compare</span>
                </th>
                <th rowSpan={2}>Lake</th>
                <th colSpan={4} className="compare-at compare-group-label compare-group-start">
                  {selectedTime ? formatSelectedWhen(selectedTime) : "Selected hour"}
                </th>
                <th colSpan={2} className="compare-peak compare-group-label compare-group-start">
                  Peak
                </th>
                <th rowSpan={2}>
                  <span className="visually-hidden">Open on map</span>
                </th>
              </tr>
              <tr>
                <SortTh
                  className="compare-at compare-group-start"
                  label="Wind"
                  value="wind"
                  sort={sort}
                  onSort={setSort}
                />
                <SortTh
                  className="compare-at"
                  label="Waves"
                  value="hs"
                  sort={sort}
                  onSort={setSort}
                />
                <th className="compare-at">Temp</th>
                <th className="compare-at">Conditions</th>
                <SortTh
                  className="compare-peak compare-group-start"
                  label="Waves"
                  value="peakHs"
                  sort={sort}
                  onSort={setSort}
                />
                <SortTh
                  className="compare-peak"
                  label="Wind"
                  value="peakWind"
                  sort={sort}
                  onSort={setSort}
                />
              </tr>
            </thead>
            <tbody>
              {ranked.map((row) => {
                const on = selected.includes(row.meta.id);
                const disabled =
                  row.status !== "ready" ||
                  (!on && selected.length >= MAX_COMPARE_LAKES);
                const at =
                  row.status === "ready"
                    ? snapshotAtTime(row, selectedTime)
                    : null;
                const conditions =
                  row.status === "ready"
                    ? formatConditions(at?.weatherCode, at?.precipMm)
                    : "—";
                return (
                  <tr
                    key={row.meta.id}
                    className={on ? "is-selected" : undefined}
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
                    <td className="compare-name" title={row.meta.name}>
                      {row.meta.name}
                    </td>
                    <td className="compare-at compare-group-start">
                      {row.status === "loading"
                        ? "…"
                        : row.status === "error"
                          ? "unavailable"
                          : formatWindNow(
                              at?.windSpeedMps,
                              at?.windDirDeg,
                              units.wind,
                            )}
                    </td>
                    <td className="compare-at">
                      {row.status === "ready" ? formatHs(at?.hsM, units.wave) : "—"}
                    </td>
                    <td className="compare-at">
                      {row.status === "ready"
                        ? formatTempNow(at?.tempC, units.temp)
                        : "—"}
                    </td>
                    <td
                      className="compare-at compare-conditions"
                      title={conditions === "—" ? undefined : conditions}
                    >
                      {conditions}
                    </td>
                    <td className="compare-peak compare-group-start">
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
                    <td className="compare-peak">
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
