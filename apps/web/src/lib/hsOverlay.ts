import type { GridMeta } from "@chop/wave-engine";
import {
  DEFAULT_WAVE_SCALE,
  sampleRgba,
  type ColorScaleId,
} from "./colorScales";

/** Fixed Hs color scale max (m). Values above clip to the top stop. */
export const HS_COLOR_MAX_M = 1;

/** Color scale for Hs in meters → [r,g,b,a]. */
export function hsColor(
  hsM: number,
  vmax: number = HS_COLOR_MAX_M,
  scale: ColorScaleId = DEFAULT_WAVE_SCALE,
): [number, number, number, number] {
  if (!Number.isFinite(hsM) || hsM < 0) return [0, 0, 0, 0];
  const t = Math.max(0, Math.min(1, hsM / Math.max(vmax, 0.01)));
  // Fairly opaque on water so light-wind days still show a field
  return sampleRgba(scale, t, 150, 255);
}

/** Rasterize Hs grid to ImageData for MapLibre image source. */
export function hsToImageData(
  hs: Float32Array,
  meta: GridMeta,
  vmax: number = HS_COLOR_MAX_M,
  scale: ColorScaleId = DEFAULT_WAVE_SCALE,
): ImageData {
  const { ncols, nrows } = meta;
  const img = new ImageData(ncols, nrows);
  const px = img.data;
  for (let i = 0; i < ncols * nrows; i++) {
    const [r, g, b, a] = hsColor(hs[i]!, vmax, scale);
    const o = i * 4;
    px[o] = r;
    px[o + 1] = g;
    px[o + 2] = b;
    px[o + 3] = a;
  }
  return img;
}

/** Draw a simple north-pointing arrow for map.addImage. */
export function makeArrowIcon(size = 64): {
  width: number;
  height: number;
  data: Uint8Array;
} {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.translate(size / 2, size / 2);
  ctx.fillStyle = "rgba(28, 32, 30, 0.92)";
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.4);
  ctx.lineTo(size * 0.22, size * 0.18);
  ctx.lineTo(0, size * 0.05);
  ctx.lineTo(-size * 0.22, size * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const img = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: new Uint8Array(img.data) };
}
