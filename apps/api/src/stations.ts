/**
 * Alberta MSC / NAV CANADA surface stations (SWOB) via GeoMet-OGC-API,
 * plus the PLWA Pigeon Lake monitoring buoy (WQData LIVE).
 * Locations from swob-stations; observations from swob-realtime for the
 * current UTC clock hour only. The buoy is appended when its latest
 * sample falls in that same hour.
 */
import {
  getPigeonBuoy,
  PLWA_PORTAL_URL,
  resetPigeonBuoyCache,
  type BuoyObs,
} from "./pigeon-buoy.ts";

const GEOMET_API = "https://api.weather.gc.ca";
const UA = "chop-lake-app/1.0";
const AB_BBOX = "-120,49,-110,60";
const CATALOG_TTL_MS = 12 * 60 * 60 * 1000;
const OBS_TTL_MS = 5 * 60 * 1000;
const PAGE_LIMIT = 1000;
const MAX_FEATURES = 8000;

const WIND_SPEED_KEYS = [
  "avg_wnd_spd_10m_pst10mts",
  "avg_wnd_spd_10m_pst2mts",
  "avg_wnd_spd_10m_pst1mt",
  "avg_wnd_spd_10m_pst1hr",
  "avg_wnd_spd_pst10mts",
] as const;

const WIND_DIR_KEYS = [
  "avg_wnd_dir_10m_pst10mts",
  "avg_wnd_dir_10m_pst2mts",
  "avg_wnd_dir_10m_pst1mt",
  "avg_wnd_dir_10m_pst1hr",
  "avg_wnd_dir_pst10mts",
] as const;

const WIND_GUST_KEYS = [
  "max_wnd_spd_10m_pst10mts",
  "max_wnd_gst_spd_10m_pst10mts",
  "max_wnd_spd_10m_pst1hr",
  "max_wnd_spd_10m_pst1mt",
] as const;

export type StationProperties = {
  id: string;
  name: string;
  network: string;
  provider: string;
  autoMan: string | null;
  mscId: string | null;
  icao: string | null;
  wmo: string | null;
  observedAt: string | null;
  airTempC: number | null;
  windSpeedMps: number | null;
  windDirDeg: number | null;
  windGustMps: number | null;
  relHum: number | null;
  /** Wind TO bearing for a north-up MapLibre icon. */
  bearing: number | null;
  hasWind: 0 | 1;
  hasObs: 0 | 1;
};

export type StationFeature = {
  type: "Feature";
  id: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: StationProperties;
};

export type StationsResponse = {
  fetchedAt: string;
  source: string;
  status: "ok" | "unavailable";
  type: "FeatureCollection";
  features: StationFeature[];
};

export type StationsResult = {
  data: StationsResponse;
  cache: "hit" | "miss" | "stale";
};

type GeoMetFeature = {
  id?: string | number;
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: Record<string, unknown> | null;
};

type GeoMetCollection = {
  numberMatched?: number;
  numberReturned?: number;
  features?: GeoMetFeature[];
};

type CatalogRow = {
  id: string;
  name: string;
  network: string;
  provider: string;
  autoMan: string | null;
  mscId: string | null;
  icao: string | null;
  wmo: string | null;
  lon: number;
  lat: number;
};

export type ObsRow = {
  key: string;
  observedAt: string;
  airTempC: number | null;
  windSpeedMps: number | null;
  windDirDeg: number | null;
  windGustMps: number | null;
  relHum: number | null;
};

type CacheEntry<T> = { payload: T; storedAt: number };

let catalogCache: CacheEntry<CatalogRow[]> | null = null;
let obsCache: CacheEntry<Map<string, ObsRow>> | null = null;
let inflight: Promise<StationsResult> | null = null;

export function kmhToMps(kmh: number): number {
  return kmh / 3.6;
}

export function toBearing(fromDeg: number): number {
  return ((fromDeg + 180) % 360 + 360) % 360;
}

export function pickNum(
  props: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const v = props[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export function pickStr(
  props: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const v = props[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

export function pointCoords(
  geometry: GeoMetFeature["geometry"],
): [number, number] | null {
  const c = geometry?.coordinates;
  if (!Array.isArray(c) || c.length < 2) return null;
  const lon = Number(c[0]);
  const lat = Number(c[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return [lon, lat];
}

export function stationKey(props: Record<string, unknown>): string | null {
  return (
    pickStr(props, ["msc_id", "msc_id-value", "clim_id-value"]) ??
    pickStr(props, ["tc_id-value", "icao_id", "iata_id"]) ??
    pickStr(props, ["name", "name_en", "stn_nam-value"])
  );
}

export function parseCatalogFeature(f: GeoMetFeature): CatalogRow | null {
  const props = f.properties ?? {};
  const xy = pointCoords(f.geometry);
  if (!xy) return null;
  const mscId = pickStr(props, ["msc_id"]);
  const name = pickStr(props, ["name_en", "name"]) ?? mscId;
  if (!name) return null;
  const id = mscId ?? String(f.id ?? name);
  const network = pickStr(props, ["dataset_network"]) ?? "unknown";
  const provider = pickStr(props, ["data_provider_en", "data_provider"]) ?? "MSC";
  return {
    id,
    name,
    network: network || "unknown",
    provider,
    autoMan: pickStr(props, ["auto_man"]),
    mscId,
    icao: pickStr(props, ["icao_id", "iata_id"]),
    wmo: pickStr(props, ["wmo_id"]),
    lon: xy[0],
    lat: xy[1],
  };
}

export function parseObsFeature(f: GeoMetFeature): ObsRow | null {
  const props = f.properties ?? {};
  const key = stationKey(props);
  const observedAt =
    pickStr(props, ["date_tm-value", "obs_date_tm"]) ?? null;
  if (!key || !observedAt) return null;
  const speedKmh = pickNum(props, WIND_SPEED_KEYS);
  const gustKmh = pickNum(props, WIND_GUST_KEYS);
  const dir = pickNum(props, WIND_DIR_KEYS);
  return {
    key,
    observedAt,
    airTempC: pickNum(props, ["air_temp"]),
    windSpeedMps:
      speedKmh != null ? kmhToMps(speedKmh) : null,
    windDirDeg: dir,
    windGustMps: gustKmh != null ? kmhToMps(gustKmh) : null,
    relHum: pickNum(props, ["rel_hum"]),
  };
}

export function collapseLatest(rows: ObsRow[]): Map<string, ObsRow> {
  const out = new Map<string, ObsRow>();
  for (const row of rows) {
    const prev = out.get(row.key);
    if (!prev || row.observedAt > prev.observedAt) out.set(row.key, row);
  }
  return out;
}

export function utcHourStart(ms: number): number {
  return Math.floor(ms / 3_600_000) * 3_600_000;
}

/** True when `iso` falls in the same UTC clock hour as `nowMs`. */
export function obsInCurrentHour(
  iso: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  const start = utcHourStart(nowMs);
  return t >= start && t < start + 3_600_000;
}

export function currentHourDatetime(nowMs = Date.now()): string {
  const start = new Date(utcHourStart(nowMs))
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const end = new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, "Z");
  return `${start}/${end}`;
}

export function joinStations(
  catalog: CatalogRow[],
  obsByKey: Map<string, ObsRow>,
  nowMs = Date.now(),
): StationFeature[] {
  return catalog.flatMap((stn) => {
    const raw =
      (stn.mscId ? obsByKey.get(stn.mscId) : undefined) ??
      obsByKey.get(stn.id) ??
      (stn.icao ? obsByKey.get(stn.icao) : undefined) ??
      obsByKey.get(stn.name);
    const obs = raw && obsInCurrentHour(raw.observedAt, nowMs) ? raw : undefined;
    if (!obs) return [];
    const windDirDeg = obs.windDirDeg ?? null;
    const hasWind =
      obs.windSpeedMps != null &&
      Number.isFinite(obs.windSpeedMps) &&
      windDirDeg != null &&
      Number.isFinite(windDirDeg)
        ? 1
        : 0;
    const props: StationProperties = {
      id: stn.id,
      name: stn.name,
      network: stn.network,
      provider: stn.provider,
      autoMan: stn.autoMan,
      mscId: stn.mscId,
      icao: stn.icao,
      wmo: stn.wmo,
      observedAt: obs.observedAt,
      airTempC: obs.airTempC,
      windSpeedMps: obs.windSpeedMps,
      windDirDeg,
      windGustMps: obs.windGustMps,
      relHum: obs.relHum,
      bearing: windDirDeg != null ? toBearing(windDirDeg) : null,
      hasWind,
      hasObs: 1,
    };
    return [
      {
        type: "Feature",
        id: stn.id,
        geometry: { type: "Point", coordinates: [stn.lon, stn.lat] },
        properties: props,
      },
    ];
  });
}

export function featureFromBuoy(obs: BuoyObs): StationFeature {
  const windDirDeg = obs.windDirDeg;
  const hasWind =
    obs.windSpeedMps != null &&
    Number.isFinite(obs.windSpeedMps) &&
    windDirDeg != null &&
    Number.isFinite(windDirDeg)
      ? 1
      : 0;
  return {
    type: "Feature",
    id: obs.id,
    geometry: { type: "Point", coordinates: [obs.lon, obs.lat] },
    properties: {
      id: obs.id,
      name: obs.name,
      network: "PLWA",
      provider: "PLWA",
      autoMan: "AUTO",
      mscId: null,
      icao: null,
      wmo: null,
      observedAt: obs.observedAt,
      airTempC: obs.airTempC,
      windSpeedMps: obs.windSpeedMps,
      windDirDeg,
      windGustMps: obs.windGustMps,
      relHum: obs.relHum,
      bearing: windDirDeg != null ? toBearing(windDirDeg) : null,
      hasWind,
      hasObs: 1,
    },
  };
}

export function withCurrentHourBuoy(
  features: StationFeature[],
  buoy: BuoyObs | null,
  nowMs = Date.now(),
): StationFeature[] {
  if (!buoy || !obsInCurrentHour(buoy.observedAt, nowMs)) return features;
  return [...features, featureFromBuoy(buoy)];
}

async function fetchJson(url: string): Promise<GeoMetCollection> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`GeoMet stations ${res.status}`);
  return (await res.json()) as GeoMetCollection;
}

export async function fetchAllItems(
  path: string,
  params: Record<string, string>,
  getJson: (url: string) => Promise<GeoMetCollection> = fetchJson,
): Promise<GeoMetFeature[]> {
  const features: GeoMetFeature[] = [];
  let offset = 0;
  let matched: number | null = null;
  while (offset < MAX_FEATURES) {
    const q = new URLSearchParams({
      ...params,
      limit: String(PAGE_LIMIT),
      offset: String(offset),
      f: "json",
    });
    const data = await getJson(`${GEOMET_API}${path}?${q}`);
    const batch = data.features ?? [];
    matched = data.numberMatched ?? matched;
    features.push(...batch);
    if (batch.length === 0) break;
    if (matched != null && features.length >= matched) break;
    if (batch.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }
  return features;
}

async function loadCatalog(): Promise<CatalogRow[]> {
  const now = Date.now();
  if (catalogCache && now - catalogCache.storedAt < CATALOG_TTL_MS) {
    return catalogCache.payload;
  }
  const features = await fetchAllItems("/collections/swob-stations/items", {
    province_territory: "Alberta",
  });
  const rows = features
    .map(parseCatalogFeature)
    .filter((row): row is CatalogRow => row != null);
  catalogCache = { payload: rows, storedAt: now };
  return rows;
}

function obsCacheFresh(now: number): boolean {
  return (
    obsCache != null &&
    now - obsCache.storedAt < OBS_TTL_MS &&
    utcHourStart(now) === utcHourStart(obsCache.storedAt)
  );
}

async function loadObs(): Promise<Map<string, ObsRow>> {
  const now = Date.now();
  if (obsCacheFresh(now) && obsCache) {
    return obsCache.payload;
  }
  const features = await fetchAllItems("/collections/swob-realtime/items", {
    bbox: AB_BBOX,
    datetime: currentHourDatetime(now),
  });
  const parsed = features
    .map(parseObsFeature)
    .filter((row): row is ObsRow => row != null)
    .filter((row) => obsInCurrentHour(row.observedAt, now));
  const collapsed = collapseLatest(parsed);
  obsCache = { payload: collapsed, storedAt: now };
  return collapsed;
}

function emptyResponse(status: StationsResponse["status"]): StationsResponse {
  return {
    fetchedAt: new Date().toISOString(),
    source: `${GEOMET_API}/collections/swob-stations`,
    status,
    type: "FeatureCollection",
    features: [],
  };
}

function stationsSource(includeBuoy: boolean): string {
  const geomet = `${GEOMET_API}/collections/swob-stations`;
  return includeBuoy ? `${geomet} + ${PLWA_PORTAL_URL}` : geomet;
}

export async function getStations(): Promise<StationsResult> {
  const now = Date.now();
  const buoyP = getPigeonBuoy(now);
  const catalogFresh =
    catalogCache != null && now - catalogCache.storedAt < CATALOG_TTL_MS;
  if (catalogFresh && obsCacheFresh(now) && catalogCache && obsCache) {
    const buoy = await buoyP;
    const features = withCurrentHourBuoy(
      joinStations(catalogCache.payload, obsCache.payload, now),
      buoy,
      now,
    );
    return {
      data: {
        fetchedAt: new Date(obsCache.storedAt).toISOString(),
        source: stationsSource(buoy != null),
        status: "ok",
        type: "FeatureCollection",
        features,
      },
      cache: "hit",
    };
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [catalog, obs, buoy] = await Promise.all([
        loadCatalog(),
        loadObs(),
        buoyP,
      ]);
      const t = Date.now();
      return {
        data: {
          fetchedAt: new Date().toISOString(),
          source: stationsSource(buoy != null),
          status: "ok",
          type: "FeatureCollection",
          features: withCurrentHourBuoy(joinStations(catalog, obs, t), buoy, t),
        },
        cache: "miss",
      };
    } catch (err) {
      const buoy = await buoyP;
      const t = Date.now();
      if (catalogCache) {
        return {
          data: {
            fetchedAt: new Date(catalogCache.storedAt).toISOString(),
            source: stationsSource(buoy != null),
            status: "ok",
            type: "FeatureCollection",
            features: withCurrentHourBuoy(
              joinStations(
                catalogCache.payload,
                obsCache?.payload ?? new Map(),
                t,
              ),
              buoy,
              t,
            ),
          },
          cache: "stale",
        };
      }
      if (buoy && obsInCurrentHour(buoy.observedAt, t)) {
        return {
          data: {
            fetchedAt: new Date().toISOString(),
            source: PLWA_PORTAL_URL,
            status: "ok",
            type: "FeatureCollection",
            features: [featureFromBuoy(buoy)],
          },
          cache: "miss",
        };
      }
      console.error(err);
      return { data: emptyResponse("unavailable"), cache: "miss" };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Test helper. */
export function resetStationsCache(): void {
  catalogCache = null;
  obsCache = null;
  inflight = null;
  resetPigeonBuoyCache();
}
