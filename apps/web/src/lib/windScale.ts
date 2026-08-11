import {
  DEFAULT_WIND_SCALE,
  rgbaCss,
  sampleRgba,
  type ColorScaleId,
} from "./colorScales";

/** Fixed wind color scale max: 40 kt ≈ 20.58 m/s. Values above clip to the top stop. */
export const WIND_COLOR_MAX_KT = 40;
export const WIND_COLOR_MAX_MPS = WIND_COLOR_MAX_KT / 1.94384;

/** Color scale for wind speed (m/s) → [r,g,b,a]. */
export function windColor(
  mps: number,
  vmax: number = WIND_COLOR_MAX_MPS,
  scale: ColorScaleId = DEFAULT_WIND_SCALE,
): [number, number, number, number] {
  if (!Number.isFinite(mps) || mps < 0) return [0, 0, 0, 0];
  const t = Math.max(0, Math.min(1, mps / Math.max(vmax, 0.01)));
  return sampleRgba(scale, t, 170, 245);
}

export function windColorCss(
  mps: number,
  vmax: number = WIND_COLOR_MAX_MPS,
  scale: ColorScaleId = DEFAULT_WIND_SCALE,
): string {
  return rgbaCss(windColor(mps, vmax, scale));
}
