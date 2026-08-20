import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cardinalFromDeg } from "../lib/wind";
import {
  formatWindSpeed,
  mpsToWind,
  windToMps,
  type WindSpeedUnit,
} from "../lib/units";
import { WIND_COLOR_MAX_MPS } from "../lib/windScale";
import type { WindMode } from "../lib/historyRange";
import { HISTORY_DAYS, HISTORY_VIEW_DAYS } from "../lib/historyRange";
import { MOBILE_MQ } from "../lib/mobile";

type Props = {
  mode: WindMode;
  speedMps: number;
  dirDeg: number;
  onSpeedMps: (mps: number) => void;
  onDirDeg: (deg: number) => void;
  windUnit: WindSpeedUnit;
  historyStatus?: "idle" | "loading" | "ready" | "error";
  historyOffsetDays?: number;
  historyLabel?: string;
  onHistoryBack?: () => void;
  onHistoryForward?: () => void;
  canHistoryBack?: boolean;
  canHistoryForward?: boolean;
  reviewStatus?: "idle" | "loading" | "ready" | "no-time" | "error";
  reviewLabel?: string;
  reviewToolbar?: ReactNode;
  reviewFollow?: boolean;
  onReviewFollowChange?: (on: boolean) => void;
};

function eventFromDeg(el: SVGSVGElement, clientX: number, clientY: number): number {
  const r = el.getBoundingClientRect();
  const dx = clientX - (r.left + r.width / 2);
  const dy = clientY - (r.top + r.height / 2);
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return ((Math.round(deg) % 360) + 360) % 360;
}

const MODE_LABELS: Record<WindMode, string> = {
  forecast: "Forecast",
  history: "History",
  review: "Review",
  sim: "Sim",
};

export function WindSimPanel({
  mode,
  speedMps,
  dirDeg,
  onSpeedMps,
  onDirDeg,
  windUnit,
  historyStatus = "idle",
  historyOffsetDays = 0,
  historyLabel = "",
  onHistoryBack,
  onHistoryForward,
  canHistoryBack = false,
  canHistoryForward = false,
  reviewStatus = "idle",
  reviewLabel = "",
  reviewToolbar,
  reviewFollow = false,
  onReviewFollowChange,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [expanded, setExpanded] = useState(false);

  const speedMax = Math.round(mpsToWind(WIND_COLOR_MAX_MPS, windUnit));
  const speedStep = windUnit === "mps" ? 0.5 : 1;
  const speedVal = mpsToWind(speedMps, windUnit);
  const speedDigits = windUnit === "mps" ? 1 : 0;
  const toDeg = (dirDeg + 180) % 360;

  useEffect(() => {
    if (!expanded) return;
    const mq = window.matchMedia(MOBILE_MQ);
    if (!mq.matches) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Element && panelRef.current?.contains(e.target)) {
        return;
      }
      setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [expanded]);

  const setFromPointer = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const el = svgRef.current;
      if (!el) return;
      onDirDeg(eventFromDeg(el, e.clientX, e.clientY));
    },
    [onDirDeg],
  );

  if (mode === "forecast") return null;

  return (
    <div
      ref={panelRef}
      className={`sim-panel is-on${expanded ? " is-expanded" : ""}`}
    >
      <button
        type="button"
        className="sim-panel-toggle"
        aria-expanded={expanded}
        aria-controls="sim-panel-sheet"
        onClick={() => setExpanded((open) => !open)}
      >
        <span>{MODE_LABELS[mode]}</span>
        <span className="plot-fold-chevron" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      <div id="sim-panel-sheet" className="sim-panel-sheet">
      {mode === "history" && (
        <div className="sim-body">
          <p className="sim-lead">
            {historyStatus === "loading"
              ? `Loading last ${HISTORY_DAYS} days of HRDPS…`
              : historyStatus === "error"
                ? "Could not load historical wind."
                : `${HISTORY_VIEW_DAYS}-day window · last ${HISTORY_DAYS} days`}
          </p>
          {historyStatus === "ready" && (
            <div className="history-nav">
              <button
                type="button"
                className="history-nav-btn"
                disabled={!canHistoryBack}
                onClick={onHistoryBack}
                aria-label="Older period"
              >
                ←
              </button>
              <span className="history-nav-label" title={`Offset ${historyOffsetDays}d`}>
                {historyLabel}
              </span>
              <button
                type="button"
                className="history-nav-btn"
                disabled={!canHistoryForward}
                onClick={onHistoryForward}
                aria-label="Newer period"
              >
                →
              </button>
            </div>
          )}
        </div>
      )}

      {mode === "review" && (
        <div className="sim-body">
          {reviewToolbar}
          {reviewStatus === "idle" && (
            <p className="sim-lead">
              Replay lake conditions along a timed GPX or Strava session.
            </p>
          )}
          {reviewStatus === "loading" && (
            <p className="sim-lead">Loading HRDPS wind for this session…</p>
          )}
          {reviewStatus === "error" && (
            <p className="sim-lead">Could not load wind for this session.</p>
          )}
          {reviewStatus === "no-time" && (
            <p className="sim-lead">
              {reviewLabel ? `${reviewLabel} · ` : ""}
              Path only — timed GPX or Strava GPS is needed to replay
              conditions.
            </p>
          )}
          {reviewStatus === "ready" && (
            <p className="sim-lead">
              {reviewLabel || "Session"} · scrub the track to see wave height at your location
            </p>
          )}
          <button
            type="button"
            className={`review-follow-btn${reviewFollow ? " is-on" : ""}`}
            aria-pressed={reviewFollow}
            onClick={() => onReviewFollowChange?.(!reviewFollow)}
          >
            Center on point
          </button>
        </div>
      )}

      {mode === "sim" && (
        <div className="sim-body">
          <p className="sim-lead">Steady wind · heatmap updates live</p>

          <label className="sim-field">
            <span className="sim-label">Speed</span>
            <input
              type="range"
              min={0}
              max={speedMax}
              step={speedStep}
              value={Number(speedVal.toFixed(speedDigits))}
              onChange={(e) =>
                onSpeedMps(windToMps(Number(e.target.value), windUnit))
              }
            />
            <span className="sim-value">
              {formatWindSpeed(speedMps, windUnit)}
            </span>
          </label>

          <div className="sim-dir">
            <svg
              ref={svgRef}
              className="sim-compass"
              viewBox="-50 -50 100 100"
              role="slider"
              aria-label="Wind from direction"
              aria-valuemin={0}
              aria-valuemax={359}
              aria-valuenow={dirDeg}
              aria-valuetext={`${cardinalFromDeg(dirDeg)} ${dirDeg}°`}
              onPointerDown={(e) => {
                dragging.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                setFromPointer(e);
              }}
              onPointerMove={(e) => {
                if (!dragging.current) return;
                setFromPointer(e);
              }}
              onPointerUp={() => {
                dragging.current = false;
              }}
              onPointerCancel={() => {
                dragging.current = false;
              }}
            >
              <circle className="sim-compass-ring" r="40" />
              {(["N", "E", "S", "W"] as const).map((lab, i) => {
                const a = (i * 90 * Math.PI) / 180;
                const x = Math.sin(a) * 46;
                const y = -Math.cos(a) * 46;
                return (
                  <text key={lab} className="sim-compass-card" x={x} y={y}>
                    {lab}
                  </text>
                );
              })}
              <g transform={`rotate(${toDeg})`}>
                <line className="sim-compass-shaft" x1="0" y1="14" x2="0" y2="-28" />
                <polygon className="sim-compass-head" points="0,-34 5.5,-22 -5.5,-22" />
              </g>
              <circle className="sim-compass-hub" r="3" />
            </svg>
            <div className="sim-dir-meta">
              <span className="sim-label">From</span>
              <strong>
                {cardinalFromDeg(dirDeg)} {Math.round(dirDeg)}°
              </strong>
              <span className="sim-toward">toward {cardinalFromDeg(toDeg)}</span>
              <input
                className="sim-dir-num"
                type="number"
                min={0}
                max={359}
                step={1}
                value={Math.round(dirDeg)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  onDirDeg(((n % 360) + 360) % 360);
                }}
              />
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
