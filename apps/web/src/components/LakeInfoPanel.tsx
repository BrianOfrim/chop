import { useEffect, useRef } from "react";
import type { AdvisoriesResponse, LakeAdvisory } from "../lib/advisories";
import { AHS_BGA_URL, AHS_LISTING_URL } from "../lib/advisories";

type Props = {
  open: boolean;
  onClose: () => void;
  lakeName: string;
  summary?: string;
  feed: AdvisoriesResponse | null;
  feedStatus: "idle" | "loading" | "ready" | "error";
  lake: LakeAdvisory | undefined;
};

function formatIssued(isoDay: string | undefined): string | null {
  if (!isoDay) return null;
  const m = isoDay.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDay;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return dt.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function LakeInfoPanel({
  open,
  onClose,
  lakeName,
  summary,
  feed,
  feedStatus,
  lake,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointer = (e: PointerEvent) => {
      if (
        e.target instanceof Element &&
        e.target.closest(".lake-info")
      ) {
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open, onClose]);

  if (!open) return null;

  const unavailable = feedStatus === "error" || feed?.status === "unavailable";
  const loading = feedStatus === "idle" || feedStatus === "loading";
  const active = Boolean(lake?.advisory);
  const issued = formatIssued(lake?.issued);
  const noticeUrl = lake?.url;
  const listingUrl = feed?.sourceUrl || AHS_LISTING_URL;
  const bgaUrl = feed?.bgaUrl || AHS_BGA_URL;

  return (
    <div
      ref={panelRef}
      id="lake-info-panel"
      className="lake-info-panel"
      role="dialog"
      aria-label={`${lakeName} conditions`}
    >
      <div className="lake-info-head">
        <strong>{lakeName}</strong>
        <button
          type="button"
          className="strava-icon-btn"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {summary && <p className="lake-info-summary">{summary}</p>}

      {loading && !feed ? (
        <p className="lake-info-status">Loading advisory status…</p>
      ) : unavailable ? (
        <p className="lake-info-status is-unknown">
          Advisory status could not be loaded. Check Alberta Health Services
          before you go.
        </p>
      ) : active ? (
        <p className="lake-info-status is-advisory">
          Alberta Health Services has issued a cyanobacteria (blue-green algae)
          advisory for this lake
          {issued ? ` (${issued})` : ""}.
        </p>
      ) : (
        <p className="lake-info-status">
          No active AHS cyanobacteria advisory for this lake. That is not a
          guarantee the water is clear — not every waterbody is monitored, and
          blooms can appear or shift with the wind.
        </p>
      )}

      <p className="lake-info-note">
        Avoid water that looks like scum, paint, grass clippings, or pea soup.
        Do not drink or cook with untreated lake water; boiling does not remove
        cyanobacterial toxins. For health advice call 811.
      </p>

      <p className="lake-info-links">
        {active && noticeUrl && (
          <a href={noticeUrl} target="_blank" rel="noopener noreferrer">
            AHS notice
          </a>
        )}
        <a href={listingUrl} target="_blank" rel="noopener noreferrer">
          {unavailable ? "Check AHS" : "AHS advisories"}
        </a>
        <a href={bgaUrl} target="_blank" rel="noopener noreferrer">
          Cyanobacteria info
        </a>
      </p>
      <p className="lake-info-source">Source: Alberta Health Services</p>
    </div>
  );
}
