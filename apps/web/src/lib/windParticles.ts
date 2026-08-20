import type { Map as MapLibreMap } from "maplibre-gl";
import { sampleWindField, type WindFieldSlice } from "./windField";
import { pointInAlberta, windArrowsGeoJSON } from "./windOverlay";

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
const SPAWN_TRIES = 48;
const OCCUPANCY_CELL_PX = 26;
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

function makeParticle(lon: number, lat: number): Particle {
  return {
    lon,
    lat,
    age: Math.random() * 1.2,
    maxAge: 4.2 + Math.random() * 5.5,
    trail: [{ lon, lat }],
    fade: 1,
    dying: false,
  };
}

function trySpawnAt(
  map: MapLibreMap,
  slice: WindFieldSlice,
  x: number,
  y: number,
): Particle | null {
  const ll = map.unproject([x, y]);
  if (!pointInAlberta(ll.lng, ll.lat)) return null;
  if (!sampleWindField(slice, ll.lng, ll.lat)) return null;
  return makeParticle(ll.lng, ll.lat);
}

function spawn(
  map: MapLibreMap,
  slice: WindFieldSlice,
  width: number,
  height: number,
): Particle | null {
  for (let n = 0; n < SPAWN_TRIES; n++) {
    const next = trySpawnAt(
      map,
      slice,
      Math.random() * width,
      Math.random() * height,
    );
    if (next) return next;
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

function occupancySize(width: number, height: number): {
  cols: number;
  rows: number;
} {
  return {
    cols: Math.max(1, Math.ceil(width / OCCUPANCY_CELL_PX)),
    rows: Math.max(1, Math.ceil(height / OCCUPANCY_CELL_PX)),
  };
}

function occupancyIndex(
  x: number,
  y: number,
  width: number,
  height: number,
  cols: number,
  rows: number,
): number {
  const col = Math.min(cols - 1, Math.max(0, Math.floor((x / width) * cols)));
  const row = Math.min(rows - 1, Math.max(0, Math.floor((y / height) * rows)));
  return row * cols + col;
}

/** Drop particles that have left the viewport (pan). */
function dropOffscreen(
  map: MapLibreMap,
  particles: Particle[],
  width: number,
  height: number,
): void {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]!;
    const screen = map.project([p.lon, p.lat]);
    if (inView(screen.x, screen.y, width, height)) continue;
    particles.splice(i, 1);
    i -= 1;
  }
}

function fillEmptyCells(
  map: MapLibreMap,
  slice: WindFieldSlice,
  particles: Particle[],
  width: number,
  height: number,
  want: number,
): void {
  let living = 0;
  for (const p of particles) {
    if (!p.dying) living += 1;
  }
  if (living >= want) return;

  const { cols, rows } = occupancySize(width, height);
  const filled = new Uint8Array(cols * rows);
  for (const p of particles) {
    if (p.dying) continue;
    const screen = map.project([p.lon, p.lat]);
    if (!inView(screen.x, screen.y, width, height)) continue;
    filled[occupancyIndex(screen.x, screen.y, width, height, cols, rows)] = 1;
  }

  const empty: number[] = [];
  for (let i = 0; i < filled.length; i++) {
    if (!filled[i]) empty.push(i);
  }
  for (let i = empty.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = empty[i]!;
    empty[i] = empty[j]!;
    empty[j] = tmp;
  }

  for (const idx of empty) {
    if (living >= want) return;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = ((col + 0.2 + Math.random() * 0.6) / cols) * width;
    const y = ((row + 0.2 + Math.random() * 0.6) / rows) * height;
    const next = trySpawnAt(map, slice, x, y);
    if (!next) continue;
    particles.push(next);
    living += 1;
  }

  let misses = 0;
  while (living < want && misses < 8) {
    const next = spawn(map, slice, width, height);
    if (!next) {
      misses += 1;
      continue;
    }
    particles.push(next);
    living += 1;
    misses = 0;
  }
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
  opts: { fade: boolean; viewChanged?: boolean; zoomChanged?: boolean },
): boolean {
  const synced = syncParticleCanvas(canvas, map);
  if (!synced) return false;
  const { ctx, width, height } = synced;
  const step = Math.min(0.05, Math.max(0, dt));
  const want = particleCountForView(width, height);

  if (opts.zoomChanged) {
    particles.length = 0;
  } else if (opts.viewChanged) {
    dropOffscreen(map, particles, width, height);
  }
  fillEmptyCells(map, slice, particles, width, height, want);

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

  return true;
}

/** Static wind arrows on the glyph canvas so they sit above MapLibre heatmaps. */
export function drawWindArrows(
  canvas: HTMLCanvasElement,
  map: MapLibreMap,
  slice: WindFieldSlice,
): void {
  const synced = syncParticleCanvas(canvas, map);
  if (!synced) return;
  const { ctx, width, height } = synced;
  ctx.clearRect(0, 0, width, height);
  const fc = windArrowsGeoJSON(slice, map.getZoom());
  ctx.strokeStyle = WIND_STREAK_COLOR;
  ctx.lineWidth = 1.7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    const lines =
      g.type === "MultiLineString"
        ? g.coordinates
        : g.type === "LineString"
          ? [g.coordinates]
          : [];
    for (const line of lines) {
      if (line.length < 2) continue;
      ctx.beginPath();
      let started = false;
      for (const pos of line) {
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
      if (started) ctx.stroke();
    }
  }
}
