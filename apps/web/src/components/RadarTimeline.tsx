import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ForecastTimeAxis } from "./ForecastTimeAxis";
import { sliderInsetStyle } from "../lib/forecastChart";
import {
  formatRadarLegend,
  formatRadarWhen,
  radarTimeline,
  resolveRadarFrame,
  type RadarWindows,
} from "../lib/radar";
import {
  formatRadarPrecipCopy,
  prefetchRadarPrecipRasters,
  sampleRadarPrecipSeries,
  type LonLat,
} from "../lib/radarPrecip";

type Props = {
  windows: RadarWindows | null;
  committedIndex: number;
  followLive: boolean;
  onCommitIndex: (index: number) => void;
  shoreline: GeoJSON.FeatureCollection | null;
  pin: LonLat | null;
};

function isAbortError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "name" in err &&
    (err as { name: string }).name === "AbortError"
  );
}

/** Keyboard / trailing input after a click: wait for the value to settle. */
const SCRUB_SETTLE_MS = 280;
/** While holding the thumb, load radar only after the index stays put. */
const SCRUB_DWELL_MS = 400;
/** Pointer held at least this long is a drag; shorter is a track jump. */
const SCRUB_DRAG_MS = 250;

export function RadarTimeline({
  windows,
  committedIndex,
  followLive,
  onCommitIndex,
  shoreline,
  pin,
}: Props) {
  const clock = useMemo(() => radarTimeline(windows), [windows]);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [cacheGen, setCacheGen] = useState(0);
  const draggingRef = useRef(false);
  const pointerDownAtRef = useRef(0);
  const lastCommittedIsoRef = useRef<string | null>(null);
  const commitTimerRef = useRef<number | null>(null);

  const displayIndex = scrubIndex ?? committedIndex;
  const displayIso = clock.times[displayIndex] ?? null;
  const series = useMemo(() => {
    if (!shoreline) return clock.times.map(() => null);
    return sampleRadarPrecipSeries(clock.times, windows, shoreline, pin);
  }, [clock.times, windows, shoreline, pin, cacheGen]);
  const frame = useMemo(
    () =>
      resolveRadarFrame(
        displayIso ? Date.parse(displayIso) : null,
        windows,
        followLive && scrubIndex == null,
      ),
    [displayIso, windows, followLive, scrubIndex],
  );

  useEffect(() => {
    if (!windows || !shoreline || clock.times.length === 0) return;
    const ac = new AbortController();
    const shore = shoreline;
    const times = clock.times;
    void prefetchRadarPrecipRasters(
      times,
      windows,
      shore,
      () => {
        setCacheGen((n) => n + 1);
      },
      ac.signal,
    ).catch((err) => {
      if (isAbortError(err)) return;
      console.error("Radar precip failed", err);
    });
    return () => {
      ac.abort();
    };
  }, [windows, shoreline, clock.times]);

  const precipMode = pin ? "pin" : "lake";
  const selectedPrecip = series[displayIndex];
  const precipCopy = selectedPrecip?.pending
    ? "Loading precip…"
    : selectedPrecip
      ? formatRadarPrecipCopy(
          selectedPrecip.rainMmH,
          selectedPrecip.snowCmH,
          selectedPrecip.mode,
        )
      : null;

  const clearCommitTimer = useCallback(() => {
    if (commitTimerRef.current == null) return;
    window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
  }, []);

  const pushCommit = useCallback(
    (index: number, clearScrub: boolean) => {
      const iso = clock.times[index] ?? null;
      const skipped = lastCommittedIsoRef.current === iso;
      if (!skipped) {
        lastCommittedIsoRef.current = iso;
        onCommitIndex(index);
      }
      if (clearScrub) setScrubIndex(null);
    },
    [clock.times, onCommitIndex],
  );

  const scheduleCommit = useCallback(
    (index: number, delayMs: number, clearScrub: boolean) => {
      clearCommitTimer();
      if (delayMs <= 0) {
        pushCommit(index, clearScrub);
        return;
      }
      commitTimerRef.current = window.setTimeout(() => {
        commitTimerRef.current = null;
        pushCommit(index, clearScrub);
      }, delayMs);
    },
    [clearCommitTimer, pushCommit],
  );

  const commitIndex = useCallback(
    (index: number) => {
      clearCommitTimer();
      pushCommit(index, true);
    },
    [clearCommitTimer, pushCommit],
  );

  const scrubIndexTo = useCallback(
    (index: number) => {
      setScrubIndex(index);
      if (draggingRef.current) {
        scheduleCommit(index, SCRUB_DWELL_MS, false);
        return;
      }
      scheduleCommit(index, SCRUB_SETTLE_MS, true);
    },
    [scheduleCommit],
  );

  useEffect(() => () => clearCommitTimer(), [clearCommitTimer]);

  return (
    <div id="radar-timeline" className="forecast-panel radar-timeline">
      <div className="forecast-plot compare-selected-time-row">
        <div className="forecast-plot-rail" aria-hidden />
        <p
          className="compare-selected-time"
          aria-live={scrubIndex == null ? "polite" : "off"}
        >
          {!windows
            ? "Loading radar…"
            : formatRadarLegend(frame) ?? "No radar this hour"}
          {followLive && scrubIndex == null ? " · Now" : ""}
          {precipCopy ? ` · ${precipCopy}` : ""}
        </p>
      </div>
      {clock.times.length > 0 ? (
        <div className="forecast-plot">
          <div className="forecast-plot-rail" aria-hidden />
          <ForecastTimeAxis
            times={clock.times}
            hourIndex={displayIndex}
            onSelectHour={commitIndex}
            minuteLabelStep={15}
            precip={series}
            precipMode={precipMode}
            liveIndex={clock.liveIndex}
          />
        </div>
      ) : null}
      <div className="forecast-plot scrubber-row">
        <div className="forecast-plot-rail scrubber-rail">
          <button
            type="button"
            className="now-btn"
            disabled={
              clock.times.length === 0 ||
              (followLive && committedIndex === clock.liveIndex)
            }
            onClick={() => commitIndex(clock.liveIndex)}
          >
            Now
          </button>
        </div>
        <div
          className="scrubber"
          style={sliderInsetStyle(Math.max(1, clock.times.length))}
        >
          <input
            type="range"
            min={0}
            max={Math.max(0, clock.times.length - 1)}
            value={displayIndex}
            disabled={clock.times.length === 0}
            onChange={(e) => scrubIndexTo(Number(e.target.value))}
            onPointerDown={(e) => {
              draggingRef.current = true;
              pointerDownAtRef.current = performance.now();
              e.currentTarget.setPointerCapture(e.pointerId);
              clearCommitTimer();
            }}
            onPointerUp={(e) => {
              draggingRef.current = false;
              const index = Number(e.currentTarget.value);
              const held = performance.now() - pointerDownAtRef.current;
              const jump = held < SCRUB_DRAG_MS;
              if (jump) {
                scheduleCommit(index, SCRUB_SETTLE_MS, true);
              } else {
                commitIndex(index);
              }
            }}
            onPointerCancel={(e) => {
              draggingRef.current = false;
              commitIndex(Number(e.currentTarget.value));
            }}
            aria-label="Radar time"
            aria-valuetext={
              displayIso
                ? `${formatRadarWhen(displayIso)}${
                    followLive && scrubIndex == null ? ", now" : ""
                  }${precipCopy ? `, ${precipCopy}` : ""}`
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
