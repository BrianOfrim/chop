import type { Map as MapLibreMap } from "maplibre-gl";

export type FetchRayHover = {
  lon: number;
  lat: number;
  onWater?: boolean;
  fetchM: number | null;
  windDirDeg: number | null;
};

export type FetchRaySpec = {
  lon: number;
  lat: number;
  windFromDeg: number;
};

/** When the hover card shows fetch, this is the ray we should paint. */
export function resolveFetchRay(
  hover: FetchRayHover | null | undefined,
  fallbackDirDeg?: number | null,
): FetchRaySpec | null {
  if (!hover) return null;
  if (hover.onWater === false) return null;
  if (hover.fetchM == null || !(hover.fetchM > 0)) return null;
  const dir = hover.windDirDeg ?? fallbackDirDeg ?? null;
  if (dir == null || !Number.isFinite(dir)) return null;
  return { lon: hover.lon, lat: hover.lat, windFromDeg: dir };
}

export function fetchRayFeatures(
  spec: FetchRaySpec,
  end: [number, number],
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { kind: "fetch-ray" },
        geometry: {
          type: "LineString",
          coordinates: [
            [spec.lon, spec.lat],
            end,
          ],
        },
      },
      {
        type: "Feature",
        properties: { kind: "hover" },
        geometry: { type: "Point", coordinates: [spec.lon, spec.lat] },
      },
      {
        type: "Feature",
        properties: { kind: "shore" },
        geometry: { type: "Point", coordinates: end },
      },
    ],
  };
}

function overlayCssSize(canvas: HTMLCanvasElement): {
  cssW: number;
  cssH: number;
} {
  const wrap = canvas.parentElement;
  return {
    cssW: wrap?.clientWidth || canvas.clientWidth,
    cssH: wrap?.clientHeight || canvas.clientHeight,
  };
}

function sizeOverlayCanvas(
  canvas: HTMLCanvasElement,
): { ctx: CanvasRenderingContext2D; cssW: number; cssH: number } | null {
  const { cssW, cssH } = overlayCssSize(canvas);
  if (cssW < 2 || cssH < 2) return null;
  const dpr = Math.min(
    2,
    (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1,
  );
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  return { ctx, cssW, cssH };
}

function drawPoint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string,
  stroke: string,
): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}

/**
 * Upwind fetch ray + hover/shore points.
 * Pass `{ clear: false }` when painting onto an already-sized overlay canvas.
 */
export function drawFetchRay(
  canvas: HTMLCanvasElement,
  map: Pick<MapLibreMap, "project">,
  ray: GeoJSON.FeatureCollection | null | undefined,
  satellite: boolean,
  opts?: { clear?: boolean },
): void {
  const clear = opts?.clear !== false;
  let ctx: CanvasRenderingContext2D | null = null;
  let cssW = 0;
  let cssH = 0;
  if (clear) {
    const sized = sizeOverlayCanvas(canvas);
    if (!sized) return;
    ctx = sized.ctx;
    cssW = sized.cssW;
    cssH = sized.cssH;
  } else {
    ctx = canvas.getContext("2d");
    const size = overlayCssSize(canvas);
    cssW = size.cssW;
    cssH = size.cssH;
  }
  if (!ctx || !ray?.features.length) return;

  const ink = satellite ? "#f4f1ea" : "#1c201e";
  const cream = satellite ? "rgba(20, 28, 26, 0.9)" : "#f8f6f0";

  for (const f of ray.features) {
    if (f.properties?.kind !== "fetch-ray") continue;
    if (f.geometry.type !== "LineString") continue;
    const coords = f.geometry.coordinates;
    if (coords.length < 2) continue;
    ctx.beginPath();
    let started = false;
    for (const pos of coords) {
      const lon = pos[0];
      const lat = pos[1];
      if (lon == null || lat == null) continue;
      const p = map.project([lon, lat]);
      if (!started) {
        ctx.moveTo(p.x, p.y);
        started = true;
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    if (!started) continue;
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2.2;
    ctx.setLineDash([4.4, 3.3]);
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  for (const f of ray.features) {
    const kind = f.properties?.kind;
    if (kind !== "hover" && kind !== "shore") continue;
    if (f.geometry.type !== "Point") continue;
    const lon = f.geometry.coordinates[0];
    const lat = f.geometry.coordinates[1];
    if (lon == null || lat == null) continue;
    const p = map.project([lon, lat]);
    if (p.x < -10 || p.y < -10 || p.x > cssW + 10 || p.y > cssH + 10) continue;
    if (kind === "hover") {
      drawPoint(ctx, p.x, p.y, 4.5, ink, cream);
    } else {
      drawPoint(ctx, p.x, p.y, 3.5, cream, ink);
    }
  }
}
