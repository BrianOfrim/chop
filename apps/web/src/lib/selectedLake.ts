const STORAGE_KEY = "chop.lakeId";
export const DEFAULT_LAKE_ID = "ca-ab-pigeon-lake";

export function loadLakeId(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && v.length > 0) return v;
  } catch {
    // ignore quota / private mode
  }
  return null;
}

export function saveLakeId(id: string | null): void {
  try {
    if (!id) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore quota / private mode
  }
}
