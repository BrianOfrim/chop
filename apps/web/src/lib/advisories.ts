export const AHS_LISTING_URL =
  "https://www.albertahealthservices.ca/news/Listing12848.aspx";
export const AHS_BGA_URL =
  "https://www.albertahealthservices.ca/news/bga.aspx";

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

export async function fetchAdvisories(): Promise<AdvisoriesResponse> {
  const res = await globalThis.fetch("/api/advisories");
  if (!res.ok) throw new Error("Failed to load AHS advisories");
  return (await res.json()) as AdvisoriesResponse;
}

export function lakeAdvisory(
  data: AdvisoriesResponse | null,
  lakeId: string,
): LakeAdvisory | undefined {
  return data?.lakes[lakeId];
}
