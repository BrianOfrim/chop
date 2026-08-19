import type { UnitPrefs, TempUnit, WaveHeightUnit, WindSpeedUnit } from "../lib/units";
import {
  TEMP_UNIT_OPTIONS,
  WAVE_UNIT_OPTIONS,
  WIND_UNIT_OPTIONS,
} from "../lib/units";
import type { LakeIndexEntry } from "../lib/lakeAssets";
import type { AppView } from "../lib/view";

type Props = {
  view: AppView;
  units: UnitPrefs;
  onUnits: (patch: Partial<UnitPrefs>) => void;
  lakeId?: string;
  lakes?: LakeIndexEntry[];
  onLakeId?: (id: string) => void;
  advisoryLakeIds?: ReadonlySet<string>;
};

export function Topbar({
  view,
  units,
  onUnits,
  lakeId,
  lakes,
  onLakeId,
  advisoryLakeIds,
}: Props) {
  const showLakePicker = view === "map" && lakes && onLakeId && lakeId != null;
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">chop</span>
        <span className="brand-sub">inland lake waves</span>
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
      {showLakePicker && (
        <label className="lake-picker">
          Lake
          <select
            value={lakeId}
            onChange={(e) => onLakeId(e.target.value)}
            disabled={lakes.length === 0}
          >
            {lakes.map((l) => (
              <option key={l.id} value={l.id}>
                {advisoryLakeIds?.has(l.id) ? `${l.name} · advisory` : l.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="unit-prefs" title="Display units">
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
    </header>
  );
}
