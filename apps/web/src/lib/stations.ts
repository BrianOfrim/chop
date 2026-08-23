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

export const STATIONS_STORAGE_KEY = "chop.stations";
export const STATIONS_POLL_MS = 5 * 60 * 1000;

export const EMPTY_STATIONS: StationsResponse = {
  fetchedAt: "",
  source: "",
  status: "unavailable",
  type: "FeatureCollection",
  features: [],
};

export function loadStationsOn(): boolean {
  try {
    return localStorage.getItem(STATIONS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveStationsOn(on: boolean): void {
  try {
    localStorage.setItem(STATIONS_STORAGE_KEY, on ? "1" : "0");
  } catch {
    // ignore quota / private mode
  }
}

export function utcHourStart(ms: number): number {
  return Math.floor(ms / 3_600_000) * 3_600_000;
}

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

export function filterCurrentHourStations(
  data: StationsResponse | null,
  nowMs = Date.now(),
): StationsResponse | null {
  if (!data) return data;
  return {
    ...data,
    features: data.features.filter((f) =>
      obsInCurrentHour(f.properties.observedAt, nowMs),
    ),
  };
}

export async function fetchStations(): Promise<StationsResponse> {
  const res = await globalThis.fetch("/api/stations");
  if (!res.ok) throw new Error(`Stations ${res.status}`);
  return (await res.json()) as StationsResponse;
}

export function stationNetworkLabel(network: string, provider: string): string {
  if (network === "CA") return "MSC";
  if (network === "NC-AWOS") return "NAV CANADA AWOS";
  if (network === "NC-HWOS") return "NAV CANADA";
  if (network === "PLWA" || provider === "PLWA") return "PLWA buoy";
  if (provider === "NAV CANADA") return "NAV CANADA";
  if (provider === "MSC") return "MSC";
  return provider || network || "Station";
}
