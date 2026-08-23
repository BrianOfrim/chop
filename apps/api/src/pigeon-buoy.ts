/**
 * Pigeon Lake Watershed Association monitoring buoy via WQData LIVE.
 * Public portal: https://www.wqdatalive.com/public/1495
 * Latest values from POST /public/{project}/sidebar (same payload the portal UI uses).
 */
const UA = "chop-lake-app/1.0";
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

export const PLWA_PROJECT_ID = 1495;
export const PLWA_SITE_ID = 2618;
export const PLWA_BUOY_ID = "plwa-central-buoy";
export const PLWA_BUOY_NAME = "Pigeon Lake Buoy";
export const PLWA_PORTAL_URL = `https://www.wqdatalive.com/public/${PLWA_PROJECT_ID}`;
export const PLWA_SIDEBAR_URL = `${PLWA_PORTAL_URL}/sidebar`;
/** Central-basin position published on the WQData LIVE public portal. */
export const PLWA_BUOY_LON = -114.03124;
export const PLWA_BUOY_LAT = 53.01546;

export type BuoyObs = {
  id: string;
  name: string;
  lon: number;
  lat: number;
  observedAt: string;
  airTempC: number | null;
  windSpeedMps: number | null;
  windDirDeg: number | null;
  windGustMps: number | null;
  relHum: number | null;
};

export type SidebarParam = {
  id?: number;
  name?: string;
  value?: string;
  unit?: string;
};

export type SidebarResponse = {
  error?: boolean;
  data?: Record<string, SidebarParam[]>;
  latestTimestamp?: string | null;
};

type CacheEntry = { payload: BuoyObs | null; storedAt: number };

let cache: CacheEntry | null = null;
let inflight: Promise<BuoyObs | null> | null = null;

export function parseBuoyTimestamp(raw: string): string | null {
  const m = raw
    .trim()
    .match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\s*\(UTC\s*([+-])\s*(\d{2}):(\d{2})\))?$/,
    );
  if (!m) return null;
  const sec = m[6] ?? "00";
  const sign = m[7] ?? "+";
  const hh = m[8] ?? "00";
  const mm = m[9] ?? "00";
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${sec}${m[7] ? `${sign}${hh}:${mm}` : "Z"}`;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

export function parseBuoyNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!s || s === "--") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function findSidebarParam(
  params: SidebarParam[],
  name: string,
): SidebarParam | undefined {
  const want = name.toLowerCase();
  return params.find((p) => (p.name ?? "").trim().toLowerCase() === want);
}

/** Convert a reported wind speed into m/s. Portal weather is typically already m/s. */
export function windToMps(value: number, unit: string | undefined): number {
  const u = (unit ?? "").toLowerCase();
  if (u.includes("km") || u === "kph") return value / 3.6;
  if (u.includes("kt") || u.includes("knot")) return value * 0.514444;
  if (u.includes("mph")) return value * 0.44704;
  return value;
}

function latestSidebarSample(
  data: Record<string, SidebarParam[]>,
): { observedAt: string; params: SidebarParam[] } | null {
  let best: { observedAt: string; params: SidebarParam[]; t: number } | null =
    null;
  for (const [raw, params] of Object.entries(data)) {
    const observedAt = parseBuoyTimestamp(raw);
    if (!observedAt || !Array.isArray(params)) continue;
    const t = Date.parse(observedAt);
    if (!best || t > best.t) best = { observedAt, params, t };
  }
  return best;
}

export function parsePigeonBuoySidebar(
  payload: SidebarResponse,
): BuoyObs | null {
  if (payload.error || !payload.data) return null;
  const sample = latestSidebarSample(payload.data);
  if (!sample) return null;
  const { observedAt, params } = sample;
  const air = findSidebarParam(params, "Air Temperature");
  const rh = findSidebarParam(params, "Relative Humidity");
  const spd = findSidebarParam(params, "Wind Speed");
  const gst = findSidebarParam(params, "Wind Gust");
  const dir = findSidebarParam(params, "Wind Direction");
  const speed = parseBuoyNumber(spd?.value);
  const gust = parseBuoyNumber(gst?.value);
  return {
    id: PLWA_BUOY_ID,
    name: PLWA_BUOY_NAME,
    lon: PLWA_BUOY_LON,
    lat: PLWA_BUOY_LAT,
    observedAt,
    airTempC: parseBuoyNumber(air?.value),
    windSpeedMps: speed != null ? windToMps(speed, spd?.unit) : null,
    windDirDeg: parseBuoyNumber(dir?.value),
    windGustMps: gust != null ? windToMps(gust, gst?.unit) : null,
    relHum: parseBuoyNumber(rh?.value),
  };
}

function cacheFresh(now: number): boolean {
  if (!cache) return false;
  if (now - cache.storedAt >= CACHE_TTL_MS) return false;
  const hour = Math.floor(now / 3_600_000);
  const cachedHour = Math.floor(cache.storedAt / 3_600_000);
  return hour === cachedHour;
}

async function fetchPigeonBuoy(): Promise<BuoyObs | null> {
  const res = await fetch(PLWA_SIDEBAR_URL, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `siteID=${PLWA_SITE_ID}`,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`PLWA buoy ${res.status}`);
  const payload = (await res.json()) as SidebarResponse;
  return parsePigeonBuoySidebar(payload);
}

export async function getPigeonBuoy(now = Date.now()): Promise<BuoyObs | null> {
  if (cacheFresh(now) && cache) return cache.payload;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const obs = await fetchPigeonBuoy();
      cache = { payload: obs, storedAt: Date.now() };
      return obs;
    } catch (err) {
      console.error(err);
      return cache?.payload ?? null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Test helper. */
export function resetPigeonBuoyCache(): void {
  cache = null;
  inflight = null;
}
