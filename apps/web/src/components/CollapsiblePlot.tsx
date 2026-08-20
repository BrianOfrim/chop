import { useCallback, useState, type ReactNode } from "react";

const STORAGE_KEY = "chop.collapsedPlots";

function loadMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveMap(map: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota / private mode
  }
}

type Props = {
  id: string;
  title: string;
  children: ReactNode;
};

export function CollapsiblePlot({ id, title, children }: Props) {
  const [collapsed, setCollapsed] = useState(() => loadMap()[id] === true);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      const all = loadMap();
      all[id] = next;
      saveMap(all);
      return next;
    });
  }, [id]);

  return (
    <div className={`plot-fold${collapsed ? " is-collapsed" : ""}`}>
      <button
        type="button"
        className="plot-fold-toggle"
        aria-expanded={!collapsed}
        aria-controls={`plot-${id}`}
        onClick={toggle}
      >
        <span className="plot-fold-label">
          <span className="plot-fold-chevron" aria-hidden>
            {collapsed ? "▸" : "▾"}
          </span>
          <span className={collapsed ? undefined : "plot-fold-title-expanded"}>
            {title}
          </span>
        </span>
      </button>
      {!collapsed && (
        <div id={`plot-${id}`} className="plot-fold-body">
          {children}
        </div>
      )}
    </div>
  );
}
