import { useCallback, useRef } from "react";
import { cardinalFromDeg } from "../lib/wind";
import {
  formatWindSpeed,
  mpsToWind,
  windToMps,
  type WindSpeedUnit,
} from "../lib/units";
import { WIND_COLOR_MAX_MPS } from "../lib/windScale";

type Props = {
  active: boolean;
  onActiveChange: (on: boolean) => void;
  speedMps: number;
  dirDeg: number;
  onSpeedMps: (mps: number) => void;
  onDirDeg: (deg: number) => void;
  windUnit: WindSpeedUnit;
};

function eventFromDeg(el: SVGSVGElement, clientX: number, clientY: number): number {
  const r = el.getBoundingClientRect();
  const dx = clientX - (r.left + r.width / 2);
  const dy = clientY - (r.top + r.height / 2);
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return ((Math.round(deg) % 360) + 360) % 360;
}

export function WindSimPanel({
  active,
  onActiveChange,
  speedMps,
  dirDeg,
  onSpeedMps,
  onDirDeg,
  windUnit,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  const speedMax = Math.round(mpsToWind(WIND_COLOR_MAX_MPS, windUnit));
  const speedStep = windUnit === "mps" ? 0.5 : 1;
  const speedVal = mpsToWind(speedMps, windUnit);
  const speedDigits = windUnit === "mps" ? 1 : 0;
  const toDeg = (dirDeg + 180) % 360;

  const setFromPointer = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const el = svgRef.current;
      if (!el) return;
      onDirDeg(eventFromDeg(el, e.clientX, e.clientY));
    },
    [onDirDeg],
  );

  return (
    <div className={`sim-panel${active ? " is-on" : ""}`}>
      <div className="sim-tabs" role="tablist" aria-label="Wind source">
        <button
          type="button"
          role="tab"
          aria-selected={!active}
          className={!active ? "is-on" : ""}
          onClick={() => onActiveChange(false)}
        >
          Forecast
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active}
          className={active ? "is-on" : ""}
          onClick={() => onActiveChange(true)}
        >
          Sim
        </button>
      </div>

      {active && (
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
  );
}
