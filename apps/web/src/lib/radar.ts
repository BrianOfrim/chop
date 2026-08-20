/** Environment Canada GeoMet weather radar (WMS), latest 6-minute composite. */

const GEOMET = "https://geo.weather.gc.ca/geomet";

export const RADAR_RAIN_SOURCE = "radar-rain";
export const RADAR_SNOW_SOURCE = "radar-snow";

export const RADAR_WMS_LAYERS = [
  { sourceId: RADAR_SNOW_SOURCE, wmsLayer: "RADAR_1KM_RSNO" },
  { sourceId: RADAR_RAIN_SOURCE, wmsLayer: "RADAR_1KM_RRAI" },
] as const;

export const RADAR_ATTRIBUTION =
  'Radar &copy; <a href="https://eccc-msc.github.io/open-data/licence/readme_en/">Environment and Climate Change Canada</a>';

/** Poll while the layer is on; GeoMet publishes a new frame every 6 minutes. */
export const RADAR_POLL_MS = 2 * 60 * 1000;

export function radarTileUrl(
  wmsLayer: string,
  timeIso?: string | null,
): string {
  // Keep `{bbox-epsg-3857}` literal — MapLibre substitutes it per tile.
  let url =
    `${GEOMET}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap` +
    `&LAYERS=${encodeURIComponent(wmsLayer)}` +
    `&STYLES=&CRS=EPSG:3857&BBOX={bbox-epsg-3857}` +
    `&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE`;
  if (timeIso) url += `&TIME=${encodeURIComponent(timeIso)}`;
  return url;
}

export function parseRadarTime(xml: string): string | null {
  const dim = /<Dimension\s+name="time"[^>]*>/i.exec(xml)?.[0];
  if (!dim) return null;
  const fromDefault = /\bdefault="([^"]+)"/i.exec(dim)?.[1];
  if (fromDefault) return fromDefault;
  const body = /<Dimension\s+name="time"[^>]*>([^<]*)<\/Dimension>/i.exec(
    xml,
  )?.[1];
  if (!body) return null;
  const range = body.trim().split("/");
  return range.length >= 2 ? range[1]!.trim() : range[0]!.trim() || null;
}

export async function fetchRadarTime(): Promise<string | null> {
  const url = `${GEOMET}?service=WMS&version=1.3.0&request=GetCapabilities&layer=RADAR_1KM_RRAI`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Radar capabilities ${res.status}`);
  return parseRadarTime(await res.text());
}

export function formatRadarWhen(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
