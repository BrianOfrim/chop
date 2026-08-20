import { approxMaxHs, type FetchDirStats } from "@chop/wave-engine";
import {
  loadLakeCompareAssets,
  loadLakeIndex,
  proxyLatLon,
  type LakeIndexEntry,
} from "./lakeAssets";
import {
  sliceForecastHours,
  type ForecastRangeHours,
} from "./forecastRange";
import { fetchHrdpsWind, nearestHourIndex, type WindHour } from "./wind";

export const MAX_COMPARE_LAKES = 4;
export const COMPARE_CONCURRENCY = 6;

const SELECTED_KEY = "chop.compareLakes";

export type CompareSort = "peakHs" | "hs" | "peakWind" | "wind";

export type LakeCompareMeta = {
  id: string;
  name: string;
  path: string;
  lat: number;
  lon: number;
  waveStats: FetchDirStats | null;
};

export type HourSnapshot = {
  time: string;
  windSpeedMps: number;
  windDirDeg: number;
  hsM: number | null;
  tempC: number | null;
  weatherCode: number | null;
  precipMm: number;
};

export type LakeCompareRow = {
  meta: LakeCompareMeta;
  status: "loading" | "ready" | "error";
  /** Full point-forecast series (not window-sliced). */
  forecastHours: WindHour[];
  hours: WindHour[];
  hsM: Array<number | null>;
  now: HourSnapshot | null;
  peakHs: HourSnapshot | null;
  peakWind: HourSnapshot | null;
  error?: string;
};

export function loadSelectedCompareLakes(fallbackId: string): string[] {
  try {
    const raw = localStorage.getItem(SELECTED_KEY);
    if (!raw) return [fallbackId];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [fallbackId];
    const ids = parsed.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    const unique = [...new Set(ids)].slice(0, MAX_COMPARE_LAKES);
    return unique.length > 0 ? unique : [fallbackId];
  } catch {
    return [fallbackId];
  }
}

export function saveSelectedCompareLakes(ids: string[]): void {
  try {
    localStorage.setItem(
      SELECTED_KEY,
      JSON.stringify(ids.slice(0, MAX_COMPARE_LAKES)),
    );
  } catch {
    // ignore quota / private mode
  }
}

/** Put `lakeId` first so Compare and the map share the same primary lake. */
export function promoteSelectedLake(selected: string[], lakeId: string): string[] {
  if (!lakeId) return selected;
  if (selected[0] === lakeId) return selected;
  const rest = selected.filter((id) => id !== lakeId);
  return [lakeId, ...rest].slice(0, MAX_COMPARE_LAKES);
}

export async function loadEnabledLakes(): Promise<LakeIndexEntry[]> {
  const list = await loadLakeIndex();
  return list.filter((l) => l.enabled);
}

export async function loadCompareMetas(
  lakes: LakeIndexEntry[],
): Promise<LakeCompareMeta[]> {
  return Promise.all(
    lakes.map(async (lake) => {
      const { spot, waveStats } = await loadLakeCompareAssets(lake.path);
      const { lat, lon } = proxyLatLon(spot);
      return {
        id: lake.id,
        name: lake.name,
        path: lake.path,
        lat,
        lon,
        waveStats,
      };
    }),
  );
}

function hsForHour(
  hour: WindHour,
  stats: FetchDirStats | null,
): number | null {
  if (!stats) return null;
  return approxMaxHs(hour.windSpeedMps, hour.windDirDeg, stats);
}

function snapshot(hour: WindHour, hsM: number | null): HourSnapshot {
  return {
    time: hour.time,
    windSpeedMps: hour.windSpeedMps,
    windDirDeg: hour.windDirDeg,
    hsM,
    tempC: hour.tempC,
    weatherCode: hour.weatherCode,
    precipMm: hour.precipMm,
  };
}

export function summarizeLakeForecast(
  meta: LakeCompareMeta,
  forecastHours: WindHour[],
  rangeHours: ForecastRangeHours,
  nowMs: number = Date.now(),
): Pick<LakeCompareRow, "hours" | "hsM" | "now" | "peakHs" | "peakWind"> {
  const sliced = sliceForecastHours(forecastHours, rangeHours, nowMs);
  const hsM = sliced.map((h) => hsForHour(h, meta.waveStats));
  const nowIndex = nearestHourIndex(sliced, nowMs);
  const nowHour = sliced[nowIndex] ?? null;
  let peakHs: HourSnapshot | null = null;
  let peakWind: HourSnapshot | null = null;
  sliced.forEach((h, i) => {
    const hs = hsM[i] ?? null;
    if (hs != null && (peakHs == null || (peakHs.hsM ?? -1) < hs)) {
      peakHs = snapshot(h, hs);
    }
    if (peakWind == null || h.windSpeedMps > peakWind.windSpeedMps) {
      peakWind = snapshot(h, hs);
    }
  });
  return {
    hours: sliced,
    hsM,
    now: nowHour ? snapshot(nowHour, hsM[nowIndex] ?? null) : null,
    peakHs,
    peakWind,
  };
}

export function applyCompareRange(
  row: LakeCompareRow,
  rangeHours: ForecastRangeHours,
  nowMs: number = Date.now(),
): LakeCompareRow {
  if (row.status !== "ready") return row;
  return {
    ...row,
    ...summarizeLakeForecast(row.meta, row.forecastHours, rangeHours, nowMs),
  };
}

function emptyRow(meta: LakeCompareMeta, status: "loading" | "error", error?: string): LakeCompareRow {
  return {
    meta,
    status,
    forecastHours: [],
    hours: [],
    hsM: [],
    now: null,
    peakHs: null,
    peakWind: null,
    error,
  };
}

export function loadingRows(metas: LakeCompareMeta[]): LakeCompareRow[] {
  return metas.map((meta) => emptyRow(meta, "loading"));
}

async function mapPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i;
      i += 1;
      const item = items[idx];
      if (item === undefined) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function loadCompareForecasts(
  metas: LakeCompareMeta[],
  rangeHours: ForecastRangeHours,
  onRow: (row: LakeCompareRow) => void,
  isCancelled: () => boolean,
): Promise<void> {
  await mapPool(metas, COMPARE_CONCURRENCY, async (meta) => {
    if (isCancelled()) return;
    try {
      const wind = await fetchHrdpsWind(meta.lat, meta.lon);
      if (isCancelled()) return;
      const summary = summarizeLakeForecast(meta, wind.hours, rangeHours);
      onRow({
        meta,
        status: "ready",
        forecastHours: wind.hours,
        ...summary,
      });
    } catch (e) {
      if (isCancelled()) return;
      onRow(emptyRow(meta, "error", String(e)));
    }
  });
}

function sortValue(
  row: LakeCompareRow,
  sort: CompareSort,
  atTime?: string,
): number {
  if (row.status !== "ready") return Number.NEGATIVE_INFINITY;
  switch (sort) {
    case "peakHs":
      return row.peakHs?.hsM ?? Number.NEGATIVE_INFINITY;
    case "hs":
      return snapshotAtTime(row, atTime)?.hsM ?? Number.NEGATIVE_INFINITY;
    case "peakWind":
      return row.peakWind?.windSpeedMps ?? Number.NEGATIVE_INFINITY;
    case "wind":
      return snapshotAtTime(row, atTime)?.windSpeedMps ?? Number.NEGATIVE_INFINITY;
  }
}

export function snapshotAtTime(
  row: LakeCompareRow,
  time: string | undefined,
): HourSnapshot | null {
  if (row.status !== "ready" || row.hours.length === 0) return null;
  if (!time) return row.now;
  let i = row.hours.findIndex((h) => h.time === time);
  if (i < 0) {
    const t = Date.parse(time);
    i = Number.isFinite(t) ? nearestHourIndex(row.hours, t) : -1;
  }
  const hour = i >= 0 ? row.hours[i] : undefined;
  if (!hour) return row.now;
  return snapshot(hour, row.hsM[i] ?? null);
}

export function sortCompareRows(
  rows: LakeCompareRow[],
  sort: CompareSort,
  atTime?: string,
): LakeCompareRow[] {
  return [...rows].sort((a, b) => {
    const ready = Number(b.status === "ready") - Number(a.status === "ready");
    if (ready !== 0) return ready;
    const diff = sortValue(b, sort, atTime) - sortValue(a, sort, atTime);
    if (diff !== 0) return diff;
    return a.meta.name.localeCompare(b.meta.name);
  });
}

export function compareChartTimes(series: Array<{ hours: Array<{ time: string }> }>): string[] {
  const set = new Set<string>();
  for (const s of series) {
    for (const h of s.hours) set.add(h.time);
  }
  return [...set].sort();
}

export function toggleSelectedLake(
  selected: string[],
  lakeId: string,
): string[] {
  if (selected.includes(lakeId)) {
    return selected.filter((id) => id !== lakeId);
  }
  if (selected.length >= MAX_COMPARE_LAKES) return selected;
  return [...selected, lakeId];
}
