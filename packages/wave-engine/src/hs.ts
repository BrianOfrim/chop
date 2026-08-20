import { G, depthLimitHs } from "./smb.js";

/** Young & Verhagen (1996) fully developed dimensionless energy. */
const YV_EPS_MAX = 3.64e-3;
const YV_A1 = 0.493;
const YV_B1 = 3.13e-3;

/**
 * CEM / SPM time to reach fetch-limited waves:
 * t = 77.23 X^0.67 / (U^0.34 g^0.33)  (seconds, metres, m/s).
 */
const CEM_DURATION_K = 77.23;
const CEM_FETCH_EXP = 0.67;
const CEM_U_EXP = 0.34;
const CEM_G_EXP = 0.33;

/** Same-event direction window (deg) for duration from an hourly series. */
export const WIND_EVENT_DIR_TOL_DEG = 45;
/** Same-event floor as a fraction of the current hour's speed. */
export const WIND_EVENT_MIN_SPEED_FRAC = 0.5;

export type WindHourLike = {
  time?: string;
  windSpeedMps: number;
  windDirDeg: number;
};

/** Smallest absolute bearing difference in [0, 180]. */
export function angularDiffDeg(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/**
 * Young & Verhagen (1996) finite-depth fetch-limited Hs (m).
 * Depth enters the growth curve, not only a breaker cap.
 */
export function yvHs(uMps: number, fetchM: number, depthM: number): number {
  if (!(uMps > 0) || !(fetchM > 0) || !(depthM > 0)) return 0;
  const u2 = uMps * uMps;
  const chi = (G * fetchM) / u2;
  const delta = (G * depthM) / u2;
  const tanhA1 = Math.tanh(YV_A1 * Math.pow(delta, 0.75));
  if (!(tanhA1 > 0)) return 0;
  const b1 = YV_B1 * Math.pow(chi, 0.57);
  const eps = YV_EPS_MAX * (tanhA1 * Math.tanh(b1 / tanhA1)) ** 2;
  return 4 * (u2 / G) * Math.sqrt(eps);
}

/**
 * Equivalent fetch (m) for a wind that has blown `durationSec` seconds.
 * Invert the CEM duration-to-limit formula.
 */
export function equivalentFetchM(uMps: number, durationSec: number): number {
  if (!(uMps > 0) || !(durationSec > 0)) return 0;
  const num =
    durationSec *
    Math.pow(uMps, CEM_U_EXP) *
    Math.pow(G, CEM_G_EXP);
  return Math.pow(num / CEM_DURATION_K, 1 / CEM_FETCH_EXP);
}

/** Geometric fetch capped by duration-limited equivalent fetch. */
export function durationLimitedFetchM(
  fetchM: number,
  uMps: number,
  durationSec: number | undefined,
): number {
  if (!(fetchM > 0)) return 0;
  if (durationSec == null || !Number.isFinite(durationSec)) return fetchM;
  if (!(durationSec > 0)) return 0;
  return Math.min(fetchM, equivalentFetchM(uMps, durationSec));
}

/**
 * Production Hs: Young–Verhagen growth, optional duration cap, then Hs ≤ 0.4 d.
 */
export function chopHs(
  uMps: number,
  fetchM: number,
  depthM: number,
  durationSec?: number,
): number {
  const fetch = durationLimitedFetchM(fetchM, uMps, durationSec);
  return depthLimitHs(yvHs(uMps, fetch, depthM), depthM);
}

export function sameWindEvent(
  hour: WindHourLike,
  ref: WindHourLike,
  dirTolDeg: number = WIND_EVENT_DIR_TOL_DEG,
  minSpeedFrac: number = WIND_EVENT_MIN_SPEED_FRAC,
): boolean {
  if (!(hour.windSpeedMps >= minSpeedFrac * ref.windSpeedMps)) return false;
  return angularDiffDeg(hour.windDirDeg, ref.windDirDeg) <= dirTolDeg;
}

/**
 * Duration (s) of the current wind event ending at `index`.
 * If the event reaches the start of `hours`, returns undefined (treat as
 * fetch-limited — the series does not show when this wind started).
 */
export function windDurationSec(
  hours: WindHourLike[],
  index: number,
): number | undefined {
  const cur = hours[index];
  if (!cur || !(cur.windSpeedMps > 0)) return undefined;
  let start = index;
  for (let i = index - 1; i >= 0; i--) {
    if (!sameWindEvent(hours[i]!, cur)) break;
    start = i;
  }
  if (start === 0) return undefined;
  const t1 = cur.time != null ? Date.parse(cur.time) : Number.NaN;
  const t0 = hours[start]!.time != null ? Date.parse(hours[start]!.time!) : Number.NaN;
  if (Number.isFinite(t1) && Number.isFinite(t0) && t1 >= t0) {
    return (t1 - t0) / 1000 + 3600;
  }
  return (index - start + 1) * 3600;
}
