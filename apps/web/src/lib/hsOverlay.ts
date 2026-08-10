import type { GridMeta } from "@chop/wave-engine";

/** Fixed Hs color scale max (m). Values above clip to the top stop. */
export const HS_COLOR_MAX_M = 1;

/** Color scale for Hs in meters → [r,g,b,a]. */
export function hsColor(hsM: number, vmax: number = HS_COLOR_MAX_M): [number, number, number, number] {
  if (!Number.isFinite(hsM) || hsM < 0) return [0, 0, 0, 0];
  const t = Math.max(0, Math.min(1, hsM / Math.max(vmax, 0.01)));
  // Amber/teal chop scale — high opacity so it reads on top of basemap water
  const stops: Array<[number, number, number, number]> = [
    [0.0, 8, 70, 92],
    [0.25, 18, 130, 140],
    [0.5, 70, 175, 150],
    [0.75, 220, 180, 70],
    [1.0, 255, 245, 210],
  ];
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1]![0]) i++;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  const u = (t - a[0]) / (b[0] - a[0] || 1);
  return [
    Math.round(a[1] + (b[1] - a[1]) * u),
    Math.round(a[2] + (b[2] - a[2]) * u),
    Math.round(a[3] + (b[3] - a[3]) * u),
    // Always fairly opaque on water so light-wind days still show a field
    Math.round(150 + 105 * t),
  ];
}

/** Rasterize Hs grid to ImageData for MapLibre image source. */
export function hsToImageData(
  hs: Float32Array,
  meta: GridMeta,
  vmax: number = HS_COLOR_MAX_M,
): ImageData {
  const { ncols, nrows } = meta;
  const img = new ImageData(ncols, nrows);
  const px = img.data;
  for (let i = 0; i < ncols * nrows; i++) {
    const [r, g, b, a] = hsColor(hs[i]!, vmax);
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
