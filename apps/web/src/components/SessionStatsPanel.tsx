import {
  formatWindSpeed,
  mpsToWind,
  windToMps,
  windUnitLabel,
  type WindSpeedUnit,
} from "../lib/units";
import {
  saveFoilTakeoffMps,
  type FoilAnalysis,
  type ManeuverBucket,
} from "../lib/foilAnalysis";
import { sessionPointLabel } from "../lib/sessionTrack";

type StatsProps = {
  analysis: FoilAnalysis;
  windUnit: WindSpeedUnit;
  takeoffMps: number;
  onTakeoffMps: (mps: number) => void;
};

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

function formatPct(n: number): string {
  return `${Math.round(n)}%`;
}

function rate(b: ManeuverBucket): string {
  if (b.attempted === 0) return "—";
  return `${b.made}/${b.attempted} (${Math.round((100 * b.made) / b.attempted)}%)`;
}

function sideRate(b: ManeuverBucket, side: "port" | "starboard"): string {
  const s = b[side];
  if (s.attempted === 0) return "—";
  return `${s.made}/${s.attempted}`;
}

export function SessionStatsPanel({
  analysis,
  windUnit,
  takeoffMps,
  onTakeoffMps,
}: StatsProps) {
  const { stats, thresholds } = analysis;
  const takeoffDisplay = mpsToWind(takeoffMps, windUnit);
  const takeoffMin = mpsToWind(1.5, windUnit);
  const takeoffMax = mpsToWind(8, windUnit);
  const digits = windUnit === "mps" ? 1 : 0;
  const showTransitions = !stats.hasWind;

  return (
    <div className="session-stats-chart forecast-plot">
      <div className="forecast-plot-rail">
        <span aria-hidden />
        <span className="forecast-plot-title">Foil</span>
      </div>
      <div className="session-stats">
        <div className="session-stats-grid">
        <section>
          <h3>Flight</h3>
          <dl>
            <div>
              <dt>Time on foil</dt>
              <dd>
                {formatPct(stats.foilTimePct)}
                <span className="session-stats-sub">
                  {formatDuration(stats.foilDurationSec)}
                </span>
              </dd>
            </div>
            <div>
              <dt>Distance on foil</dt>
              <dd>
                {formatPct(stats.foilDistancePct)}
                <span className="session-stats-sub">
                  {formatDistance(stats.foilDistanceM)}
                </span>
              </dd>
            </div>
            <div>
              <dt>Flights</dt>
              <dd>{stats.flightCount}</dd>
            </div>
            <div>
              <dt>Longest flight</dt>
              <dd>
                {stats.flightCount === 0
                  ? "—"
                  : `${formatDuration(stats.longestFlightSec)} · ${formatDistance(stats.longestFlightM)}`}
              </dd>
            </div>
            <div>
              <dt>Time to first flight</dt>
              <dd>
                {stats.timeToFirstFlightSec == null
                  ? "—"
                  : formatDuration(stats.timeToFirstFlightSec)}
              </dd>
            </div>
          </dl>
          <label className="session-stats-threshold">
            <span>
              Takeoff {takeoffDisplay.toFixed(digits)} {windUnitLabel(windUnit)}
            </span>
            <input
              type="range"
              min={takeoffMin}
              max={takeoffMax}
              step={windUnit === "mps" ? 0.1 : 0.5}
              value={takeoffDisplay}
              onChange={(e) => {
                const mps = windToMps(Number(e.target.value), windUnit);
                onTakeoffMps(mps);
                saveFoilTakeoffMps(mps);
              }}
            />
            <span className="session-stats-sub">
              Landing {formatWindSpeed(thresholds.landingMps, windUnit)}
            </span>
          </label>
        </section>

        <section>
          <h3>Maneuvers</h3>
          {showTransitions ? (
            <dl>
              <div>
                <dt>Transitions</dt>
                <dd>{rate(stats.transitions)}</dd>
              </div>
              <p className="session-stats-note">
                Wind unavailable — tacks vs jibes not classified.
              </p>
            </dl>
          ) : (
            <dl>
              <div>
                <dt>Jibes on foil</dt>
                <dd>{rate(stats.jibes)}</dd>
              </div>
              <div>
                <dt>Tacks on foil</dt>
                <dd>{rate(stats.tacks)}</dd>
              </div>
              <div>
                <dt>Jibe port / starboard</dt>
                <dd>
                  {sideRate(stats.jibes, "port")} · {sideRate(stats.jibes, "starboard")}
                </dd>
              </div>
              <div>
                <dt>Tack port / starboard</dt>
                <dd>
                  {sideRate(stats.tacks, "port")} · {sideRate(stats.tacks, "starboard")}
                </dd>
              </div>
            </dl>
          )}
        </section>

        <section>
          <h3>Falls</h3>
          <dl>
            <div>
              <dt>Falls</dt>
              <dd>{stats.falls}</dd>
            </div>
            <div>
              <dt>Touchdowns</dt>
              <dd>{stats.touchdowns}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h3>Speed</h3>
          <dl>
            <div>
              <dt>Max</dt>
              <dd>
                {stats.maxSpeedMps != null
                  ? formatWindSpeed(stats.maxSpeedMps, windUnit)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Avg on foil</dt>
              <dd>
                {stats.avgFoilSpeedMps != null
                  ? formatWindSpeed(stats.avgFoilSpeedMps, windUnit)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Best 5 s</dt>
              <dd>
                {stats.best5sMps != null
                  ? formatWindSpeed(stats.best5sMps, windUnit)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Best 100 m</dt>
              <dd>
                {stats.best100mMps != null
                  ? formatWindSpeed(stats.best100mMps, windUnit)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Best 500 m</dt>
              <dd>
                {stats.best500mMps != null
                  ? formatWindSpeed(stats.best500mMps, windUnit)
                  : "—"}
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <h3>Course</h3>
          <dl>
            <div>
              <dt>Upwind / reach / downwind</dt>
              <dd>
                {formatDistance(stats.upwindDistanceM)} ·{" "}
                {formatDistance(stats.reachingDistanceM)} ·{" "}
                {formatDistance(stats.downwindDistanceM)}
              </dd>
            </div>
            <div>
              <dt>Best upwind</dt>
              <dd>{sessionPointLabel(stats.bestUpwindAngleDeg) ?? "—"}</dd>
            </div>
            <div>
              <dt>Best downwind</dt>
              <dd>{sessionPointLabel(stats.bestDownwindAngleDeg) ?? "—"}</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
    </div>
  );
}
