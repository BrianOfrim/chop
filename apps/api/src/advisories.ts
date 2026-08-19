/**
 * Alberta Health Services cyanobacteria advisories.
 * AHS has no JSON feed — we parse the public listing HTML and cache 12h.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./env.ts";

export const AHS_LISTING_URL =
  "https://www.albertahealthservices.ca/news/Listing12848.aspx";
export const AHS_BGA_URL =
  "https://www.albertahealthservices.ca/news/bga.aspx";
export const AHS_ORIGIN = "https://www.albertahealthservices.ca";
export const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const UA = "chop-lake-app/1.0";

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

/** Compact AHS waterbody names that do not match Chop display names. */
export const AHS_NAME_ALIASES: Record<string, string> = {
  driedmeatlake: "ca-ab-driedmeat-lake",
};

export type ChopLake = { id: string; name: string };

export type AhsListingItem = {
  ahsName: string;
  title: string;
  url: string;
  issued?: string;
};

export type LakeAdvisory = {
  advisory: boolean;
  ahsName?: string;
  issued?: string;
  title?: string;
  url?: string;
};

export type AdvisoriesResponse = {
  fetchedAt: string;
  sourceUrl: string;
  bgaUrl: string;
  status: "ok" | "unavailable";
  lakes: Record<string, LakeAdvisory>;
};

export type AdvisoriesResult = {
  data: AdvisoriesResponse;
  cache: "hit" | "miss" | "stale";
};

const ITEM_RE =
  /<h4 class="list-title">\s*<a href="([^"]+)">([\s\S]*?)<\/a>\s*<\/h4>[\s\S]*?<div class="list-date">([^<]+)<\/div>/gi;

const CYANO_RE = /cyanobacteri|blue-green\s+alga/i;

type CacheEntry = {
  payload: AdvisoriesResponse;
  storedAt: number;
};

let cache: CacheEntry | null = null;
let inflight: Promise<AdvisoriesResult> | null = null;
let chopLakes: ChopLake[] | null = null;

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCharCode(parseInt(n, 16)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Alphanumeric compact form for name matching. */
export function compactName(name: string): string {
  return decodeEntities(name)
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

export function waterbodyFromTitle(title: string): string | null {
  const decoded = decodeEntities(title).replace(/\s+/g, " ").trim();
  const m = decoded.match(/issued for\s+(.+)$/i);
  if (!m) return null;
  const name = m[1]!.trim();
  return name.length > 0 ? name : null;
}

export function parseAhsDate(raw: string): string | undefined {
  const m = raw.trim().match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return undefined;
  const month = MONTHS[m[1]!.toLowerCase()];
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (!month || !Number.isFinite(day) || !Number.isFinite(year)) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function listingMarkupValid(html: string): boolean {
  return /id="page-listing12848"|class="list-title"/i.test(html);
}

export function parseAhsListing(html: string): AhsListingItem[] {
  const items: AhsListingItem[] = [];
  const re = new RegExp(ITEM_RE.source, ITEM_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const title = decodeEntities(m[2]!).replace(/\s+/g, " ").trim();
    if (!CYANO_RE.test(title)) continue;
    const ahsName = waterbodyFromTitle(title);
    if (!ahsName) continue;
    const href = m[1]!.trim();
    const url = href.startsWith("http")
      ? href
      : new URL(href, AHS_ORIGIN).toString();
    items.push({
      ahsName,
      title,
      url,
      issued: parseAhsDate(m[3] ?? ""),
    });
  }
  return items;
}

export function matchLakeId(
  ahsName: string,
  lakes: ChopLake[],
  aliases: Record<string, string> = AHS_NAME_ALIASES,
): string | undefined {
  const key = compactName(ahsName);
  if (!key) return undefined;
  const aliasId = aliases[key];
  if (aliasId && lakes.some((l) => l.id === aliasId)) return aliasId;
  for (const lake of lakes) {
    if (compactName(lake.name) === key) return lake.id;
  }
  return undefined;
}

export function buildAdvisories(
  html: string,
  lakes: ChopLake[],
  fetchedAt: string = new Date().toISOString(),
): AdvisoriesResponse {
  const emptyLakes = (): Record<string, LakeAdvisory> => {
    const out: Record<string, LakeAdvisory> = {};
    for (const lake of lakes) out[lake.id] = { advisory: false };
    return out;
  };

  if (!listingMarkupValid(html)) {
    return {
      fetchedAt,
      sourceUrl: AHS_LISTING_URL,
      bgaUrl: AHS_BGA_URL,
      status: "unavailable",
      lakes: emptyLakes(),
    };
  }

  const items = parseAhsListing(html);
  const mapped: Record<string, LakeAdvisory> = emptyLakes();
  for (const item of items) {
    const id = matchLakeId(item.ahsName, lakes);
    if (!id) continue;
    const prev = mapped[id];
    if (prev?.advisory && prev.issued && item.issued && prev.issued > item.issued) {
      continue;
    }
    mapped[id] = {
      advisory: true,
      ahsName: item.ahsName,
      issued: item.issued,
      title: item.title,
      url: item.url,
    };
  }

  return {
    fetchedAt,
    sourceUrl: AHS_LISTING_URL,
    bgaUrl: AHS_BGA_URL,
    status: "ok",
    lakes: mapped,
  };
}

export function loadChopLakes(): ChopLake[] {
  if (chopLakes) return chopLakes;
  const file = path.join(repoRoot, "data/lakes/index.json");
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    lakes: Array<{ id: string; name: string }>;
  };
  chopLakes = raw.lakes.map((l) => ({ id: l.id, name: l.name }));
  return chopLakes;
}

function unavailablePayload(lakes: ChopLake[]): AdvisoriesResponse {
  const mapped: Record<string, LakeAdvisory> = {};
  for (const lake of lakes) mapped[lake.id] = { advisory: false };
  return {
    fetchedAt: new Date().toISOString(),
    sourceUrl: AHS_LISTING_URL,
    bgaUrl: AHS_BGA_URL,
    status: "unavailable",
    lakes: mapped,
  };
}

async function fetchAndBuild(): Promise<AdvisoriesResponse> {
  const lakes = loadChopLakes();
  const res = await fetch(AHS_LISTING_URL, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    throw new Error(`AHS listing HTTP ${res.status}`);
  }
  const html = await res.text();
  return buildAdvisories(html, lakes);
}

async function refresh(): Promise<AdvisoriesResult> {
  try {
    const payload = await fetchAndBuild();
    if (payload.status === "unavailable" && cache) {
      return { data: cache.payload, cache: "stale" };
    }
    cache = { payload, storedAt: Date.now() };
    return { data: payload, cache: "miss" };
  } catch (e) {
    console.error("AHS advisories fetch failed", e);
    if (cache) return { data: cache.payload, cache: "stale" };
    return { data: unavailablePayload(loadChopLakes()), cache: "miss" };
  }
}

export async function getAdvisories(): Promise<AdvisoriesResult> {
  const now = Date.now();
  if (cache && now - cache.storedAt < CACHE_TTL_MS) {
    return { data: cache.payload, cache: "hit" };
  }
  if (inflight) return inflight;
  inflight = refresh().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Test helper — not used at runtime. */
export function resetAdvisoriesCache(): void {
  cache = null;
  inflight = null;
}
