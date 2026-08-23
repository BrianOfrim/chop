export type LngLatBounds = [[number, number], [number, number]];
export type ViewMode = "all" | "lake";

export const MIN_MAP_CANVAS_PX = 8;

export function isMapCanvasReady(width: number, height: number): boolean {
  return width >= MIN_MAP_CANVAS_PX && height >= MIN_MAP_CANVAS_PX;
}

export type CameraRequest = {
  action: "fit-lake" | "fit-overview" | "none";
  bounds?: LngLatBounds;
  duration: number;
  viewMode: ViewMode;
  fittedLakeId: string | null;
};

function none(
  viewMode: ViewMode,
  fittedLakeId: string | null,
  duration = 0,
): CameraRequest {
  return { action: "none", duration, viewMode, fittedLakeId };
}

function fitLake(
  bounds: LngLatBounds,
  selectedId: string,
  duration: number,
): CameraRequest {
  return {
    action: "fit-lake",
    bounds,
    duration,
    viewMode: "lake",
    fittedLakeId: selectedId,
  };
}

/** First camera after the map style is ready. */
export function cameraOnBoot(input: {
  selectedId: string | null;
  selectedBounds?: LngLatBounds;
  hasOverview: boolean;
  canvasReady: boolean;
}): CameraRequest {
  if (input.selectedId && input.selectedBounds) {
    if (!input.canvasReady) return none("lake", null);
    return fitLake(input.selectedBounds, input.selectedId, 0);
  }
  if (input.hasOverview && input.canvasReady) {
    return {
      action: "fit-overview",
      duration: 0,
      viewMode: "all",
      fittedLakeId: null,
    };
  }
  return none("all", null);
}

/** Camera when the selected lake id changes, or when its bounds first arrive. */
export function cameraOnSelection(input: {
  selectedId: string | null;
  selectedBounds?: LngLatBounds;
  fittedLakeId: string | null;
  canvasReady: boolean;
}): CameraRequest {
  if (!input.selectedId) {
    if (input.fittedLakeId == null) return none("all", null);
    return {
      action: "fit-overview",
      duration: 800,
      viewMode: "all",
      fittedLakeId: null,
    };
  }
  if (input.fittedLakeId === input.selectedId) {
    return none("lake", input.selectedId);
  }
  if (!input.selectedBounds || !input.canvasReady) {
    return none("lake", input.fittedLakeId);
  }
  return fitLake(
    input.selectedBounds,
    input.selectedId,
    input.fittedLakeId == null ? 0 : 800,
  );
}

/**
 * Camera after all-lake shorelines are on the map.
 * A selected lake always wins — even if the GeoJSON source never reported a
 * loading→loaded transition.
 */
export function cameraOnShorelinesReady(input: {
  selectedId: string | null;
  selectedBounds?: LngLatBounds;
  fittedLakeId: string | null;
  userMoved: boolean;
  viewMode: ViewMode;
  canvasReady: boolean;
}): CameraRequest {
  if (input.userMoved) {
    return none(input.viewMode, input.fittedLakeId);
  }
  if (input.selectedId && input.selectedBounds) {
    if (input.fittedLakeId === input.selectedId) {
      return none("lake", input.selectedId);
    }
    if (!input.canvasReady) return none("lake", input.fittedLakeId);
    return fitLake(input.selectedBounds, input.selectedId, 0);
  }
  if (input.viewMode === "all") {
    return {
      action: "fit-overview",
      duration: 0,
      viewMode: "all",
      fittedLakeId: null,
    };
  }
  return none(input.viewMode, input.fittedLakeId);
}

/**
 * Camera after the map container is laid out. The first layout must still
 * frame a selected lake if the earlier fit ran on a tiny/zero canvas.
 */
export function cameraOnResize(input: {
  selectedId: string | null;
  selectedBounds?: LngLatBounds;
  fittedLakeId: string | null;
  userMoved: boolean;
  viewMode: ViewMode;
  canvasReady: boolean;
  followCursor: boolean;
  firstLayout: boolean;
  heightDelta: number;
}): CameraRequest {
  if (!input.canvasReady) {
    return none(input.viewMode, input.fittedLakeId);
  }
  const unfittedSelected =
    !!input.selectedId &&
    !!input.selectedBounds &&
    input.fittedLakeId !== input.selectedId &&
    !input.userMoved;
  if (unfittedSelected) {
    return fitLake(input.selectedBounds!, input.selectedId!, 0);
  }
  if (
    input.firstLayout ||
    input.followCursor ||
    input.userMoved ||
    input.heightDelta < 24
  ) {
    return none(input.viewMode, input.fittedLakeId);
  }
  if (input.viewMode === "all") {
    return {
      action: "fit-overview",
      duration: 0,
      viewMode: "all",
      fittedLakeId: null,
    };
  }
  if (input.selectedId && input.selectedBounds) {
    return fitLake(input.selectedBounds, input.selectedId, 0);
  }
  return none(input.viewMode, input.fittedLakeId);
}

/** Finish applying lake outlines as soon as the source is loaded. */
export function lakeVectorSourceReady(isSourceLoaded: boolean): boolean {
  return isSourceLoaded;
}
