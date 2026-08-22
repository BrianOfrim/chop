import { useEffect, useRef, useState } from "react";
import type { UnitPrefs, TempUnit, WaveHeightUnit, WindSpeedUnit } from "../lib/units";
import {
  TEMP_UNIT_OPTIONS,
  WAVE_UNIT_OPTIONS,
  WIND_UNIT_OPTIONS,
} from "../lib/units";
import type { LakeIndexEntry } from "../lib/lakeAssets";
import { MOBILE_MQ } from "../lib/mobile";
import type { WindMode } from "../lib/historyRange";
import type { AppView } from "../lib/view";
import type { BasemapId, WindGlyphId } from "./MapView";

const WIND_MODES = [
  ["forecast", "Forecast"],
  ["history", "History"],
  ["review", "Review"],
  ["sim", "Sim"],
] as const;

const BASEMAPS = [
  ["topo", "Topo"],
  ["map", "Map"],
  ["satellite", "Satellite"],
] as const;

const WIND_GLYPHS = [
  ["arrows", "Arrows"],
  ["particles", "Particles"],
] as const;

type Props = {
  view: AppView;
  units: UnitPrefs;
  onUnits: (patch: Partial<UnitPrefs>) => void;
  lakeId?: string | null;
  lakes?: LakeIndexEntry[];
  onLakeId?: (id: string | null) => void;
  mode?: WindMode;
  onModeChange?: (mode: WindMode) => void;
  basemap?: BasemapId;
  onBasemapChange?: (id: BasemapId) => void;
  windGlyph?: WindGlyphId;
  onWindGlyphChange?: (id: WindGlyphId) => void;
};

export function Topbar({
  view,
  units,
  onUnits,
  lakeId,
  lakes,
  onLakeId,
  mode,
  onModeChange,
  basemap,
  onBasemapChange,
  windGlyph,
  onWindGlyphChange,
}: Props) {
  const showLakePicker = view === "map" && lakes != null && onLakeId != null;
  const showModeNav = view === "map" && mode != null && onModeChange != null;
  const showBasemapNav = view === "map" && basemap != null && onBasemapChange != null;
  const showGlyphNav =
    view === "map" && windGlyph != null && onWindGlyphChange != null;
  const [unitsOpen, setUnitsOpen] = useState(false);
  const unitsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!unitsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUnitsOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof Element && unitsRef.current?.contains(e.target)) {
        return;
      }
      setUnitsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [unitsOpen]);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = () => {
      if (!mq.matches) setUnitsOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">chop</span>
      </div>
      <nav className="view-nav" aria-label="Views">
        <a
          href="#/"
          className={view === "map" ? "is-on" : undefined}
          aria-current={view === "map" ? "page" : undefined}
        >
          Map
        </a>
        <a
          href="#/compare"
          className={view === "compare" ? "is-on" : undefined}
          aria-current={view === "compare" ? "page" : undefined}
        >
          Compare
        </a>
      </nav>
      {showModeNav && (
        <div className="mode-nav" role="tablist" aria-label="Wind source">
          {WIND_MODES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              className={mode === id ? "is-on" : undefined}
              onClick={() => onModeChange?.(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {showLakePicker && (
        <label className="lake-picker">
          Lake
          <select
            value={lakeId ?? ""}
            onChange={(e) => onLakeId(e.target.value || null)}
            disabled={lakes.length === 0}
          >
            <option value="">Choose a lake</option>
            {lakes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {showBasemapNav && (
        <div className="basemap-nav" role="group" aria-label="Basemap">
          {BASEMAPS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={basemap === id}
              className={basemap === id ? "is-on" : undefined}
              onClick={() => onBasemapChange?.(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {showGlyphNav && (
        <div className="glyph-nav" role="group" aria-label="Wind glyphs">
          {WIND_GLYPHS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={windGlyph === id}
              className={windGlyph === id ? "is-on" : undefined}
              onClick={() => onWindGlyphChange?.(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="unit-prefs" title="Display units" ref={unitsRef}>
        <button
          type="button"
          className="units-toggle"
          aria-expanded={unitsOpen}
          aria-controls="unit-prefs-menu"
          onClick={() => setUnitsOpen((open) => !open)}
        >
          Units
        </button>
        <div
          id="unit-prefs-menu"
          className={`unit-prefs-menu${unitsOpen ? " is-open" : ""}`}
        >
          <label className="unit-picker">
            Wind
            <select
              value={units.wind}
              onChange={(e) =>
                onUnits({ wind: e.target.value as WindSpeedUnit })
              }
            >
              {WIND_UNIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="unit-picker">
            Waves
            <select
              value={units.wave}
              onChange={(e) =>
                onUnits({ wave: e.target.value as WaveHeightUnit })
              }
            >
              {WAVE_UNIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="unit-picker">
            Temp
            <select
              value={units.temp}
              onChange={(e) =>
                onUnits({ temp: e.target.value as TempUnit })
              }
            >
              {TEMP_UNIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </header>
  );
}
