import { describe, expect, it } from "vitest";
import {
  applyFollowZoomAround,
  isReviewFollowBreakingGesture,
} from "./mapCamera";

describe("isReviewFollowBreakingGesture", () => {
  it("keeps follow on for wheel zoom", () => {
    expect(isReviewFollowBreakingGesture({ type: "wheel" })).toBe(false);
  });

  it("keeps follow on for pinch zoom", () => {
    expect(
      isReviewFollowBreakingGesture({
        type: "touchstart",
        touches: { length: 2 },
      }),
    ).toBe(false);
  });

  it("keeps follow on for keyboard zoom", () => {
    expect(isReviewFollowBreakingGesture({ type: "keydown", key: "-" })).toBe(
      false,
    );
    expect(isReviewFollowBreakingGesture({ type: "keydown", key: "+" })).toBe(
      false,
    );
  });

  it("keeps follow on for the navigation zoom buttons", () => {
    expect(
      isReviewFollowBreakingGesture({
        type: "click",
        target: {
          closest: (sel) =>
            sel.includes("maplibregl-ctrl-zoom-out") ? {} : null,
        },
      }),
    ).toBe(false);
  });

  it("turns follow off for a drag pan", () => {
    expect(isReviewFollowBreakingGesture({ type: "mousedown" })).toBe(true);
    expect(
      isReviewFollowBreakingGesture({
        type: "touchstart",
        touches: { length: 1 },
      }),
    ).toBe(true);
  });

  it("turns follow off for keyboard pan", () => {
    expect(
      isReviewFollowBreakingGesture({ type: "keydown", key: "ArrowLeft" }),
    ).toBe(true);
  });
});

describe("applyFollowZoomAround", () => {
  function mockMap() {
    const calls: string[] = [];
    return {
      calls,
      scrollZoom: {
        disable: () => calls.push("scroll.disable"),
        enable: (options?: { around: "center" } | boolean) => {
          calls.push(
            options && typeof options === "object" && options.around === "center"
              ? "scroll.enable-center"
              : "scroll.enable",
          );
        },
      },
      touchZoomRotate: {
        disable: () => calls.push("touch.disable"),
        enable: (options?: { around: "center" } | boolean) => {
          calls.push(
            options && typeof options === "object" && options.around === "center"
              ? "touch.enable-center"
              : "touch.enable",
          );
        },
        disableRotation: () => calls.push("touch.disableRotation"),
      },
    };
  }

  it("zooms around the center while following", () => {
    const map = mockMap();
    applyFollowZoomAround(map, true);
    expect(map.calls).toEqual([
      "scroll.disable",
      "touch.disable",
      "scroll.enable-center",
      "touch.enable-center",
      "touch.disableRotation",
    ]);
  });

  it("restores cursor-centered zoom when follow is off", () => {
    const map = mockMap();
    applyFollowZoomAround(map, false);
    expect(map.calls).toEqual([
      "scroll.disable",
      "touch.disable",
      "scroll.enable",
      "touch.enable",
      "touch.disableRotation",
    ]);
  });
});
