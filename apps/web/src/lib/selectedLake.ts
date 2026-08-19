const STORAGE_KEY = "chop.lakeId";
export const DEFAULT_LAKE_ID = "ca-ab-pigeon-lake";

export function loadLakeId(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && v.length > 0) return v;
  } catch {
    // ignore quota / private mode
  }
  return DEFAULT_LAKE_ID;
}

export function saveLakeId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore quota / private mode
  }
}
