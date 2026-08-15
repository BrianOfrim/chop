import { useEffect, useMemo, useState } from "react";
import {
  WATERSPORT_TYPES,
  disconnectStrava,
  fetchStravaActivities,
  fetchStravaStatus,
  fetchStravaTrack,
  lakeForActivity,
  stravaConnectHref,
  type NamedLakeBounds,
  type StravaActivity,
  type StravaStatus,
} from "../lib/strava";
import { gpxTrackFromStrava } from "../lib/stravaTrack";
import type { GpxTrack } from "../lib/gpx";

type Props = {
  lakes?: NamedLakeBounds[];
  activeTrackLabel?: string | null;
  embedded?: boolean;
  onTrack: (track: GpxTrack, lakeId: string | null) => void;
  onError: (message: string | null) => void;
};

function formatWhen(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso || "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDistanceKm(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "—";
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

function athleteName(status: StravaStatus): string {
  const a = status.athlete;
  if (!a) return "Strava";
  return [a.firstname, a.lastname].filter(Boolean).join(" ") || "Strava";
}

const PER_PAGE = 50;
const MIN_VISIBLE = 12;
const MAX_PAGES_PER_FETCH = 8;

export function StravaPanel({
  lakes = [],
  activeTrackLabel,
  embedded = false,
  onTrack,
  onError,
}: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [activities, setActivities] = useState<StravaActivity[]>([]);
  const [page, setPage] = useState(1);
  const [listStatus, setListStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [listError, setListError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [watersportsOnly, setWatersportsOnly] = useState(true);
  const [loadingId, setLoadingId] = useState<number | null>(null);

  async function refreshStatus() {
    try {
      const next = await fetchStravaStatus();
      setStatus(next);
      setStatusError(null);
      return next;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatusError(msg);
      setStatus({ connected: false, configured: false });
      return null;
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("strava");
    if (!flag) return;
    params.delete("strava");
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", next);
    void (async () => {
      const nextStatus = await refreshStatus();
      if (flag === "connected") {
        setOpen(true);
        if (!nextStatus?.connected) {
          onError("Strava connected, but status check failed. Try again.");
        }
      } else if (flag === "error") {
        setOpen(true);
        onError("Strava authorization failed or was cancelled.");
      }
    })();
  }, [onError]);

  const visible = useMemo(() => {
    return activities.filter((a) => {
      if (watersportsOnly && !WATERSPORT_TYPES.has(a.sportType)) return false;
      return true;
    });
  }, [activities, watersportsOnly]);

  async function loadMore(reset: boolean) {
    setListStatus("loading");
    setListError(null);
    try {
      let acc = reset ? [] : activities;
      let pageNum = reset ? 0 : page;
      let exhausted = false;
      for (let i = 0; i < MAX_PAGES_PER_FETCH; i++) {
        pageNum += 1;
        const res = await fetchStravaActivities(pageNum, PER_PAGE);
        acc = acc.concat(res.activities);
        exhausted = res.activities.length < res.perPage;
        const matchCount = acc.filter((a) => {
          if (watersportsOnly && !WATERSPORT_TYPES.has(a.sportType)) return false;
          return true;
        }).length;
        if (exhausted || matchCount >= MIN_VISIBLE) break;
      }
      setActivities(acc);
      setPage(pageNum);
      setHasMore(!exhausted);
      setListStatus("ready");
    } catch (e) {
      setListStatus("error");
      setListError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (!open || !status?.connected) return;
    if (listStatus !== "idle") return;
    void loadMore(true);
  }, [open, status?.connected, listStatus]);

  async function onPick(activity: StravaActivity) {
    setLoadingId(activity.id);
    onError(null);
    try {
      const payload = await fetchStravaTrack(activity.id);
      const at = lakeForActivity(activity, lakes);
      onTrack(gpxTrackFromStrava(payload), at?.id ?? null);
      setOpen(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingId(null);
    }
  }

  async function onDisconnect() {
    try {
      await disconnectStrava();
      setStatus({ connected: false, configured: status?.configured ?? true });
      setActivities([]);
      setPage(1);
      setHasMore(true);
      setListStatus("idle");
      setListError(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  const connected = Boolean(status?.connected);
  const configured = status?.configured !== false;

  return (
    <div
      className={`strava-picker${open ? " is-open" : ""}${embedded ? " is-embedded" : ""}`}
    >
      <button
        type="button"
        className="gpx-btn"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Strava
      </button>
      {open && (
        <div className="strava-panel" role="dialog" aria-label="Strava sessions">
          <div className="strava-panel-head">
            <strong>Sessions</strong>
            <button
              type="button"
              className="strava-icon-btn"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {statusError && <p className="strava-note error">{statusError}</p>}

          {!status ? (
            <p className="strava-note">Checking Strava…</p>
          ) : !configured ? (
            <p className="strava-note">
              Add <code>STRAVA_CLIENT_ID</code> and{" "}
              <code>STRAVA_CLIENT_SECRET</code> to <code>.env.local</code>, then
              restart <code>npm run dev</code>.
            </p>
          ) : !connected ? (
            <div className="strava-connect">
              <p className="strava-note">
                Connect to list your activities and replay one on the lake.
              </p>
              <a className="gpx-btn strava-connect-btn" href={stravaConnectHref()}>
                Connect with Strava
              </a>
            </div>
          ) : (
            <>
              <div className="strava-toolbar">
                <span className="strava-athlete">{athleteName(status)}</span>
                <label className="strava-filter">
                  <input
                    type="checkbox"
                    checked={watersportsOnly}
                    onChange={(e) => setWatersportsOnly(e.target.checked)}
                  />
                  Watersports
                </label>
                <button
                  type="button"
                  className="strava-text-btn"
                  onClick={() => void onDisconnect()}
                >
                  Disconnect
                </button>
              </div>

              <ul className="strava-list">
                {visible.map((a) => {
                  const active = activeTrackLabel === a.name;
                  const at = lakeForActivity(a, lakes);
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        className={`strava-row${active ? " is-active" : ""}`}
                        disabled={loadingId != null}
                        onClick={() => void onPick(a)}
                      >
                        <span className="strava-row-name">
                          {loadingId === a.id ? "Loading track…" : a.name}
                        </span>
                        <span className="strava-row-meta">
                          {formatWhen(a.startDate)}
                          {" · "}
                          {at?.name ?? "Unknown lake"}
                          {" · "}
                          {a.sportType}
                          {" · "}
                          {formatDuration(a.movingTime || a.elapsedTime)}
                          {" · "}
                          {formatDistanceKm(a.distanceM)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {listStatus === "loading" && activities.length === 0 && (
                <p className="strava-note">Loading activities…</p>
              )}
              {listStatus === "ready" && visible.length === 0 && (
                <p className="strava-note">
                  {watersportsOnly
                    ? "No watersport sessions in this slice yet. Load more, or turn off Watersports."
                    : "No sessions in this slice yet. Load more to search further back."}
                </p>
              )}
              {listError && <p className="strava-note error">{listError}</p>}

              {connected && hasMore && (
                <button
                  type="button"
                  className="gpx-btn strava-more"
                  disabled={listStatus === "loading"}
                  onClick={() => void loadMore(false)}
                >
                  {listStatus === "loading" ? "Loading…" : "Load more"}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
