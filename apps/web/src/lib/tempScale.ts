import {
  DEFAULT_TEMP_SCALE,
  rgbaCss,
  sampleRgba,
  type ColorScaleId,
} from "./colorScales";

/** Fixed map color scale in °C. Values outside clip. */
export const TEMP_COLOR_MIN_C = 0;
export const TEMP_COLOR_MAX_C = 35;

export function tempColor(
  tempC: number,
  vmin: number = TEMP_COLOR_MIN_C,
  vmax: number = TEMP_COLOR_MAX_C,
  scale: ColorScaleId = DEFAULT_TEMP_SCALE,
): [number, number, number, number] {
  if (!Number.isFinite(tempC)) return [0, 0, 0, 0];
  const t = Math.max(0, Math.min(1, (tempC - vmin) / Math.max(vmax - vmin, 0.01)));
  return sampleRgba(scale, t, 170, 245);
}

export function tempColorCss(
  tempC: number,
  vmin: number = TEMP_COLOR_MIN_C,
  vmax: number = TEMP_COLOR_MAX_C,
  scale: ColorScaleId = DEFAULT_TEMP_SCALE,
): string {
  return rgbaCss(tempColor(tempC, vmin, vmax, scale));
}
