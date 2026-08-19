import type { Map as MapLibreMap } from "maplibre-gl";

export function polygonRings(
  geom: GeoJSON.Geometry | null,
): GeoJSON.Position[][] {
  if (!geom) return [];
  if (geom.type === "LineString") return [geom.coordinates];
  if (geom.type === "MultiLineString") return geom.coordinates;
  if (geom.type === "Polygon") return geom.coordinates;
  if (geom.type === "MultiPolygon") return geom.coordinates.flat();
  return [];
}

function widthAtZoom(zoom: number, selected: boolean): number {
  const t = Math.max(0, Math.min(1, (zoom - 4) / 7));
  return selected ? 2.6 + t * 1.2 : 2.0 + t * 0.8;
}

/**
 * Draw lake shorelines and names in screen space so they cannot sit under
 * MapLibre canvas heatmaps (those rasters composite above vector layers).
 */
function drawForecastPin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  satellite: boolean,
): void {
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fillStyle = satellite ? "rgba(20, 28, 26, 0.88)" : "rgba(248, 246, 240, 0.95)";
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = satellite ? "#f4f1ea" : "#1c201e";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fillStyle = "#0f6b5c";
  ctx.fill();
}

export function drawLakeOutlines(
  canvas: HTMLCanvasElement,
  map: MapLibreMap,
  fc: GeoJSON.FeatureCollection | null | undefined,
  selectedId: string,
  satellite: boolean,
  pin?: { lon: number; lat: number } | null,
): void {
  const wrap = canvas.parentElement;
  const cssW = wrap?.clientWidth || canvas.clientWidth;
  const cssH = wrap?.clientHeight || canvas.clientHeight;
  if (cssW < 2 || cssH < 2) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const zoom = map.getZoom();
  const stroke = satellite ? "#f4f1ea" : "#12282e";
  const halo = satellite ? "rgba(12, 16, 14, 0.8)" : "rgba(248, 246, 240, 0.95)";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (fc && fc.features.length > 0) {
    for (const f of fc.features) {
      const rings = polygonRings(f.geometry);
      if (rings.length === 0) continue;
      const selected = f.properties?.lakeId === selectedId;
      const core = widthAtZoom(zoom, selected);
      ctx.beginPath();
      for (const ring of rings) {
        if (ring.length < 2) continue;
        let started = false;
        for (const pos of ring) {
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
        if (started) ctx.closePath();
      }
      ctx.strokeStyle = halo;
      ctx.lineWidth = core + 2.4;
      ctx.stroke();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = core;
      ctx.stroke();
    }

    const labels = lakeLabelAnchors(fc);
    const size = 11 + Math.max(0, Math.min(1, (zoom - 4) / 7)) * 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    for (const label of labels) {
      const p = map.project([label.lon, label.lat]);
      if (p.x < -40 || p.y < -20 || p.x > cssW + 40 || p.y > cssH + 20) continue;
      const selected = label.id === selectedId;
      const px = size + (selected ? 1.2 : 0);
      ctx.font = `${selected ? 600 : 500} ${px}px "IBM Plex Sans", "Helvetica Neue", sans-serif`;
      ctx.strokeStyle = halo;
      ctx.lineWidth = 4;
      ctx.strokeText(label.name, p.x, p.y);
      ctx.fillStyle = stroke;
      ctx.fillText(label.name, p.x, p.y);
    }
  }

  if (pin && Number.isFinite(pin.lon) && Number.isFinite(pin.lat)) {
    const p = map.project([pin.lon, pin.lat]);
    if (p.x >= -12 && p.y >= -12 && p.x <= cssW + 12 && p.y <= cssH + 12) {
      drawForecastPin(ctx, p.x, p.y, satellite);
    }
  }
}

function lakeLabelAnchors(
  fc: GeoJSON.FeatureCollection,
): Array<{ id: string; name: string; lon: number; lat: number }> {
  const names = new Map<string, string>();
  const boxes = new Map<string, { w: number; s: number; e: number; n: number }>();
  for (const f of fc.features) {
    const id = f.properties?.lakeId;
    const name = f.properties?.name;
    if (typeof id !== "string") continue;
    if (typeof name === "string" && !names.has(id)) names.set(id, name);
    let acc = boxes.get(id);
    if (!acc) {
      acc = { w: Infinity, s: Infinity, e: -Infinity, n: -Infinity };
      boxes.set(id, acc);
    }
    for (const ring of polygonRings(f.geometry)) {
      for (const pos of ring) {
        const lon = pos[0];
        const lat = pos[1];
        if (lon == null || lat == null) continue;
        acc.w = Math.min(acc.w, lon);
        acc.e = Math.max(acc.e, lon);
        acc.s = Math.min(acc.s, lat);
        acc.n = Math.max(acc.n, lat);
      }
    }
  }
  const out: Array<{ id: string; name: string; lon: number; lat: number }> = [];
  for (const [id, acc] of boxes) {
    const name = names.get(id);
    if (!name || !Number.isFinite(acc.w)) continue;
    out.push({
      id,
      name,
      lon: (acc.w + acc.e) / 2,
      lat: (acc.s + acc.n) / 2,
    });
  }
  return out;
}
