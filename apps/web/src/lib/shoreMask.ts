import type { GridMeta } from "@chop/wave-engine";

/** Display canvas is this many times the native Hs grid (sharper shore clip). */
export const HS_CANVAS_SCALE = 2;

function lonLatToPx(
  meta: GridMeta,
  lon: number,
  lat: number,
  scale: number,
): [number, number] {
  const { ncols, nrows, west, south, east, north } = meta;
  const x = ((lon - west) / (east - west)) * ncols * scale;
  const y = ((north - lat) / (north - south)) * nrows * scale;
  return [x, y];
}

function addRing(
  ctx: CanvasRenderingContext2D,
  meta: GridMeta,
  ring: number[][],
  scale: number,
) {
  if (ring.length < 3) return;
  const first = ring[0]!;
  const [x0, y0] = lonLatToPx(meta, first[0]!, first[1]!, scale);
  ctx.moveTo(x0, y0);
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i]!;
    const [x, y] = lonLatToPx(meta, p[0]!, p[1]!, scale);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Rasterize the lake polygon(s) to a white-on-transparent mask. Built once per lake. */
export function buildShoreMaskCanvas(
  meta: GridMeta,
  shoreline: GeoJSON.FeatureCollection,
  scale: number = HS_CANVAS_SCALE,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(meta.ncols * scale));
  canvas.height = Math.max(1, Math.round(meta.nrows * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  for (const f of shoreline.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "Polygon") {
      for (const ring of g.coordinates) addRing(ctx, meta, ring, scale);
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.coordinates) {
        for (const ring of poly) addRing(ctx, meta, ring, scale);
      }
    }
  }
  ctx.fill("evenodd");
  return canvas;
}

export function hsCanvasSize(meta: GridMeta, scale: number = HS_CANVAS_SCALE) {
  return {
    width: Math.max(1, Math.round(meta.ncols * scale)),
    height: Math.max(1, Math.round(meta.nrows * scale)),
  };
}

/** Paint Hs and clip to the shoreline mask. */
export function paintHsClipped(
  ctx: CanvasRenderingContext2D,
  hsImage: ImageData,
  mask: HTMLCanvasElement,
): void {
  const { width, height } = mask;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, width, height);
  const tmp = document.createElement("canvas");
  tmp.width = hsImage.width;
  tmp.height = hsImage.height;
  tmp.getContext("2d")!.putImageData(hsImage, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, width, height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = "source-over";
}
