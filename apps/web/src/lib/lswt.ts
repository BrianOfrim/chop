import { fromUrl } from "geotiff";
import proj4 from "proj4";

/** MODIS sinusoidal sphere used by MOD11A1 / MYD11A1 COGs. */
proj4.defs(
  "MODIS_SINU",
  "+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +R=6371007.181 +units=m +no_defs",
);

const STAC_SEARCH =
  "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const STAC_SIGN =
  "https://planetarycomputer.microsoft.com/api/sas/v1/sign";

/** MOD11A1 LST: Kelvin = DN * 0.02 */
const LST_SCALE = 0.02;
const KELVIN_TO_C = 273.15;

export type LakeSurfaceTemp = {
  tempC: number;
  /** Observation date (UTC calendar day of the granule). */
  date: string;
  source: "modis-11A1";
  /** Daytime LST mixes sun-warmed shore; night is closer to water. */
  product: "LST_Night_1km" | "LST_Day_1km";
  granuleId: string;
  /** Skin / land-surface product sampled over water — not bulk column temp. */
  note: string;
};

type StacItem = {
  id: string;
  assets: Record<string, { href: string }>;
  properties?: {
    datetime?: string;
    start_datetime?: string;
  };
};

type LstBand = "LST_Night_1km" | "LST_Day_1km";

function toIsoDay(item: StacItem): string {
  const raw = item.properties?.start_datetime ?? item.properties?.datetime ?? "";
  return raw.slice(0, 10);
}

function lookbackRange(days: number): string {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return `${fmt(start)}/${fmt(end)}`;
}

async function signHref(href: string): Promise<string> {
  const url = `${STAC_SIGN}?${new URLSearchParams({ href })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PC sign failed ${res.status}`);
  const data = (await res.json()) as { href: string };
  return data.href;
}

async function searchLstItems(lat: number, lon: number): Promise<StacItem[]> {
  const res = await fetch(STAC_SEARCH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      collections: ["modis-11A1-061"],
      intersects: { type: "Point", coordinates: [lon, lat] },
      datetime: lookbackRange(21),
      limit: 40,
    }),
  });
  if (!res.ok) throw new Error(`STAC search failed ${res.status}`);
  const data = (await res.json()) as { features: StacItem[] };
  // Prefer Aqua then Terra; newest first
  return [...data.features].sort((a, b) => {
    const rank = (id: string) => (id.startsWith("MYD") ? 0 : 1);
    const bySat = rank(a.id) - rank(b.id);
    if (bySat !== 0) return bySat;
    return toIsoDay(b).localeCompare(toIsoDay(a));
  });
}

function dnToC(raw: number): number {
  return raw * LST_SCALE - KELVIN_TO_C;
}

/**
 * Sample a small neighborhood and return the median of valid pixels.
 * Median resists warm land-edge outliers better than "first hit".
 */
async function sampleLstNeighborhoodC(
  signedHref: string,
  lat: number,
  lon: number,
): Promise<number | null> {
  const [x, y] = proj4("EPSG:4326", "MODIS_SINU", [lon, lat]) as [
    number,
    number,
  ];
  const tiff = await fromUrl(signedHref);
  const image = await tiff.getImage();
  const bbox = image.getBoundingBox(); // [minX, minY, maxX, maxY]
  const width = image.getWidth();
  const height = image.getHeight();
  const resX = (bbox[2]! - bbox[0]!) / width;
  const resY = (bbox[3]! - bbox[1]!) / height;

  const vals: number[] = [];
  // ~±1 km neighborhood (MODIS 1 km cells)
  for (const dy of [-1, 0, 1]) {
    for (const dx of [-1, 0, 1]) {
      const px = Math.floor((x + dx * 1000 - bbox[0]!) / resX);
      const py = Math.floor((bbox[3]! - (y + dy * 1000)) / resY);
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const rasters = await image.readRasters({
        window: [px, py, px + 1, py + 1],
        width: 1,
        height: 1,
      });
      const band = rasters[0];
      const raw =
        Array.isArray(band) || ArrayBuffer.isView(band) ? Number(band[0]) : NaN;
      if (Number.isFinite(raw) && raw > 0) vals.push(dnToC(raw));
    }
  }
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)]!;
}

async function tryBand(
  item: StacItem,
  band: LstBand,
  lat: number,
  lon: number,
): Promise<LakeSurfaceTemp | null> {
  const asset = item.assets[band];
  if (!asset?.href) return null;
  const signed = await signHref(asset.href);
  const tempC = await sampleLstNeighborhoodC(signed, lat, lon);
  if (tempC == null) return null;
  const night = band === "LST_Night_1km";
  return {
    tempC,
    date: toIsoDay(item),
    source: "modis-11A1",
    product: band,
    granuleId: item.id,
    note: night
      ? "MODIS night skin temperature (closer to water than daytime LST)"
      : "MODIS day skin temperature — may run warm near shore/rock",
  };
}

/**
 * Latest clear-sky MODIS temperature over a lake point.
 * Prefers night LST: daytime pixels on narrow lakes often mix sun-warmed rock.
 */
export async function fetchLakeSurfaceTemp(
  lat: number,
  lon: number,
): Promise<LakeSurfaceTemp | null> {
  const items = await searchLstItems(lat, lon);
  const bands: LstBand[] = ["LST_Night_1km", "LST_Day_1km"];

  for (const band of bands) {
    for (const item of items) {
      try {
        const hit = await tryBand(item, band, lat, lon);
        if (hit) return hit;
      } catch {
        // try next granule / band
      }
    }
  }
  return null;
}

export function formatWaterTemp(tempC: number): string {
  return `${tempC.toFixed(1)} °C`;
}
