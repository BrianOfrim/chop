import { useEffect, useState } from "react";

export type AppView = "map" | "compare";

export function parseHashView(hash: string = window.location.hash): AppView {
  const path = hash.replace(/^#/, "").replace(/^\//, "").split("?")[0] ?? "";
  return path === "compare" ? "compare" : "map";
}

export function viewHash(view: AppView): string {
  return view === "compare" ? "#/compare" : "#/";
}

export function setAppView(view: AppView): void {
  const next = viewHash(view);
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}

export function useAppView(): AppView {
  const [view, setView] = useState<AppView>(() =>
    typeof window !== "undefined" ? parseHashView() : "map",
  );
  useEffect(() => {
    const onHash = () => setView(parseHashView());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return view;
}
