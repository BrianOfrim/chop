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

/** Structural event from MapLibre `movestart.originalEvent`. */
export type MapGestureEvent = {
  type: string;
  key?: string;
  touches?: { length: number };
  target?: { closest?: (selector: string) => unknown } | null;
};

/**
 * Pan/drag should leave "center on point"; wheel, pinch, +/- keys, and the
 * zoom buttons should keep following and leave the point in the middle.
 */
export function isReviewFollowBreakingGesture(
  originalEvent?: MapGestureEvent | null,
): boolean {
  if (!originalEvent) return false;
  const { type } = originalEvent;
  if (type === "wheel" || type === "mousewheel") return false;
  if (type === "keydown" || type === "keyup") {
    const key = originalEvent.key ?? "";
    return key !== "+" && key !== "-" && key !== "=" && key !== "_";
  }
  const touches = originalEvent.touches;
  if (type.startsWith("touch") && touches && touches.length >= 2) {
    return false;
  }
  const closest = originalEvent.target?.closest;
  if (
    typeof closest === "function" &&
    closest.call(
      originalEvent.target,
      ".maplibregl-ctrl-zoom-in, .maplibregl-ctrl-zoom-out",
    )
  ) {
    return false;
  }
  return true;
}

type ZoomAroundMap = {
  scrollZoom: {
    disable: () => void;
    enable: (options?: { around: "center" } | boolean) => void;
  };
  touchZoomRotate: {
    disable: () => void;
    enable: (options?: { around: "center" } | boolean) => void;
    disableRotation: () => void;
  };
};

/** When following a review point, zoom around the map center (that point). */
export function applyFollowZoomAround(map: ZoomAroundMap, follow: boolean): void {
  map.scrollZoom.disable();
  map.touchZoomRotate.disable();
  if (follow) {
    map.scrollZoom.enable({ around: "center" });
    map.touchZoomRotate.enable({ around: "center" });
  } else {
    map.scrollZoom.enable();
    map.touchZoomRotate.enable();
  }
  map.touchZoomRotate.disableRotation();
}
