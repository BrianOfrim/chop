import type { Map as MapLibreMap } from "maplibre-gl";
import { sampleWindField, type WindFieldSlice } from "./windField";
import { pointInAlberta } from "./windOverlay";

type TrailPt = { lon: number; lat: number };

type Particle = {
  lon: number;
  lat: number;
  age: number;
  maxAge: number;
  trail: TrailPt[];
  /** 1 = fully visible, 0 = gone. */
  fade: number;
  dying: boolean;
};

/** Keep this many past positions so the tail stays comet-long. */
const TRAIL_LEN = 72;
/** Screen pixels per second at 1 m/s local wind. */
const PX_PER_SEC_PER_MPS = 5.6;
const VIEW_PAD_PX = 48;
const SPAWN_TRIES = 24;
const HEAD_R = 1.15;
export const WIND_STREAK_RGB = "168,172,176";
export const WIND_STREAK_COLOR = `rgb(${WIND_STREAK_RGB})`;
const GREY = WIND_STREAK_RGB;
const FADE_OUT_SEC = 0.9;

export function prefersReducedWindMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function particleCountForView(width: number, height: number): number {
  return Math.round(
    Math.min(900, Math.max(220, (width * height) / 3200)),
  );
}

export function syncParticleCanvas(
  canvas: HTMLCanvasElement,
  map: MapLibreMap,
): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  const host = map.getContainer();
  const width = host.clientWidth;
  const height = host.clientHeight;
  if (width < 8 || height < 8) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const tw = Math.round(width * dpr);
  const th = Math.round(height * dpr);
  if (canvas.width !== tw || canvas.height !== th) {
    canvas.width = tw;
    canvas.height = th;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

export function clearParticleCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function spawn(
  map: MapLibreMap,
  slice: WindFieldSlice,
  width: number,
  height: number,
): Particle | null {
  for (let n = 0; n < SPAWN_TRIES; n++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const ll = map.unproject([x, y]);
    if (!pointInAlberta(ll.lng, ll.lat)) continue;
    if (!sampleWindField(slice, ll.lng, ll.lat)) continue;
    return {
      lon: ll.lng,
      lat: ll.lat,
      age: 0,
      maxAge: 4.2 + Math.random() * 5.5,
      trail: [{ lon: ll.lng, lat: ll.lat }],
      fade: 1,
      dying: false,
    };
  }
  return null;
}

function inView(x: number, y: number, width: number, height: number): boolean {
  return (
    x >= -VIEW_PAD_PX &&
    y >= -VIEW_PAD_PX &&
    x <= width + VIEW_PAD_PX &&
    y <= height + VIEW_PAD_PX
  );
}

export function createParticleField(): Particle[] {
  return [];
}

function drawComet(
  ctx: CanvasRenderingContext2D,
  map: MapLibreMap,
  trail: TrailPt[],
  opacity: number,
): void {
  if (opacity <= 0.01) return;
  if (trail.length < 2) {
    const p = trail[0];
    if (!p) return;
    const s = map.project([p.lon, p.lat]);
    drawHead(ctx, s.x, s.y, opacity);
    return;
  }

  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < trail.length; i++) {
    const ll = trail[i]!;
    pts.push(map.project([ll.lon, ll.lat]));
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const last = pts.length - 1;
  for (let i = 0; i < last; i++) {
    const t = (i + 1) / last;
    const fade = Math.pow(t, 0.7);
    ctx.beginPath();
    ctx.moveTo(pts[i]!.x, pts[i]!.y);
    ctx.lineTo(pts[i + 1]!.x, pts[i + 1]!.y);
    ctx.strokeStyle = `rgba(${GREY},${(0.03 + 0.38 * fade) * opacity})`;
    ctx.lineWidth = 0.21 + 1.33 * t;
    ctx.stroke();
  }

  const head = pts[last]!;
  drawHead(ctx, head.x, head.y, opacity);
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  opacity: number,
): void {
  ctx.beginPath();
  ctx.fillStyle = `rgba(${GREY},${0.22 * opacity})`;
  ctx.arc(x, y, HEAD_R * 2.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = `rgba(${GREY},${0.55 * opacity})`;
  ctx.arc(x, y, HEAD_R * 1.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = `rgba(${GREY},${opacity})`;
  ctx.arc(x, y, HEAD_R, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Advect particles along the wind field and paint comet tails.
 * Returns false if the canvas could not be sized (caller should skip the frame).
 */
export function stepWindParticles(
  canvas: HTMLCanvasElement,
  map: MapLibreMap,
  slice: WindFieldSlice,
  particles: Particle[],
  dt: number,
  _opts: { fade: boolean },
): boolean {
  const synced = syncParticleCanvas(canvas, map);
  if (!synced) return false;
  const { ctx, width, height } = synced;
  const step = Math.min(0.05, Math.max(0, dt));
  const want = particleCountForView(width, height);

  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";

  let living = 0;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]!;
    if (!p.trail) p.trail = [{ lon: p.lon, lat: p.lat }];
    if (p.fade == null) p.fade = 1;
    p.age += step;
    const sample = sampleWindField(slice, p.lon, p.lat);
    const screen = map.project([p.lon, p.lat]);
    const inDomain =
      sample != null &&
      pointInAlberta(p.lon, p.lat) &&
      inView(screen.x, screen.y, width, height);
    if (!p.dying && (p.age >= p.maxAge || !inDomain)) {
      p.dying = true;
    }
    if (p.dying) {
      p.fade -= step / FADE_OUT_SEC;
      if (p.fade <= 0) {
        particles.splice(i, 1);
        i -= 1;
        continue;
      }
    } else {
      living += 1;
    }
    if (sample) {
      const speed = Number.isFinite(sample.speedMps)
        ? Math.max(0, sample.speedMps)
        : 0;
      const toRad = ((sample.dirDeg + 180) * Math.PI) / 180;
      const pxPerSec = speed * PX_PER_SEC_PER_MPS;
      const x1 = screen.x + Math.sin(toRad) * pxPerSec * step;
      const y1 = screen.y - Math.cos(toRad) * pxPerSec * step;
      const ll = map.unproject([x1, y1]);
      p.lon = ll.lng;
      p.lat = ll.lat;
      p.trail.push({ lon: p.lon, lat: p.lat });
      if (p.trail.length > TRAIL_LEN) {
        p.trail.splice(0, p.trail.length - TRAIL_LEN);
      }
    }
    drawComet(ctx, map, p.trail, Math.max(0, p.fade));
  }

  while (living < want) {
    const next = spawn(map, slice, width, height);
    if (!next) break;
    particles.push(next);
    living += 1;
  }
  return true;
}
