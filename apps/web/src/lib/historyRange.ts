/** Last-N-days historical wind window helpers. */

import type { WindHour } from "./wind";

export const HISTORY_DAYS = 90;
/** Visible chart span while scrubbing history (keeps charts responsive). */
export const HISTORY_VIEW_DAYS = 7;

export type HistoryWindow = {
  /** Inclusive start (YYYY-MM-DD). */
  startDate: string;
  /** Inclusive end (YYYY-MM-DD). */
  endDate: string;
};

function ymdUtc(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Calendar span covering the last `HISTORY_DAYS` through today (UTC dates). */
export function historySpan(nowMs: number = Date.now()): HistoryWindow {
  const end = nowMs;
  const start = end - HISTORY_DAYS * 24 * 60 * 60 * 1000;
  return { startDate: ymdUtc(start), endDate: ymdUtc(end) };
}

/**
 * Slice cached history to a `HISTORY_VIEW_DAYS` window ending
 * `offsetDays` before now (0 = most recent).
 */
export function sliceHistoryView(
  hours: WindHour[],
  offsetDays: number,
  nowMs: number = Date.now(),
): WindHour[] {
  if (hours.length === 0) return hours;
  const maxOffset = Math.max(0, HISTORY_DAYS - HISTORY_VIEW_DAYS);
  const offset = Math.max(0, Math.min(maxOffset, offsetDays));
  const tEnd = nowMs - offset * 24 * 60 * 60 * 1000;
  const tStart = tEnd - HISTORY_VIEW_DAYS * 24 * 60 * 60 * 1000;
  return hours.filter((h) => {
    const t = Date.parse(h.time);
    return Number.isFinite(t) && t >= tStart && t <= tEnd;
  });
}

export function historyViewLabel(
  offsetDays: number,
  nowMs: number = Date.now(),
): string {
  const maxOffset = Math.max(0, HISTORY_DAYS - HISTORY_VIEW_DAYS);
  const offset = Math.max(0, Math.min(maxOffset, offsetDays));
  const tEnd = nowMs - offset * 24 * 60 * 60 * 1000;
  const tStart = tEnd - HISTORY_VIEW_DAYS * 24 * 60 * 60 * 1000;
  const fmt = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  return `${fmt(tStart)} – ${fmt(tEnd)}`;
}

export function maxHistoryOffsetDays(): number {
  return Math.max(0, HISTORY_DAYS - HISTORY_VIEW_DAYS);
}

export type WindMode = "forecast" | "history" | "review" | "sim";
