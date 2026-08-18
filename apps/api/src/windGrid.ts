/** Alberta wind-field grid. Keep in sync with apps/web/src/lib/windField.ts. */
export const WEST = -120;
export const EAST = -110;
export const SOUTH = 49;
export const NORTH = 60;
export const STEP_LAT = 0.1;
export const STEP_LON = 0.1;
export const NCOLS = Math.round((EAST - WEST) / STEP_LON) + 1;
export const NROWS = Math.round((NORTH - SOUTH) / STEP_LAT) + 1;

export function fieldExtent() {
  return {
    west: WEST - STEP_LON / 2,
    east: EAST + STEP_LON / 2,
    south: SOUTH - STEP_LAT / 2,
    north: NORTH + STEP_LAT / 2,
  };
}

export function cellLon(i: number): number {
  return WEST + i * STEP_LON;
}

export function cellLat(j: number): number {
  return NORTH - j * STEP_LAT;
}
