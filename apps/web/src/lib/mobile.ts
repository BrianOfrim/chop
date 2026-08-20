/** Shared phone/small-landscape breakpoint. Keep in sync with `@media (max-width: 720px)` in App.css. */
export const MOBILE_MQ = "(max-width: 720px)";

export function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_MQ).matches;
}
