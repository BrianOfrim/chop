import { useMemo } from "react";
import { CHART_PAD, CHART_W, buildTimeAxis, xAtTimeMs } from "../lib/forecastChart";
import {
  nearestIndexByTime,
  type FoilAnalysis,
  type FoilSegment,
} from "../lib/foilAnalysis";
import type { SessionSample } from "../lib/sessionTrack";

type Props = {
  analysis: FoilAnalysis;
  samples: SessionSample[];
  sampleIndex: number;
  onSelectSample: (index: number) => void;
};

type FlightKind = "takeoff" | "touchdown" | "fall";

const W = CHART_W;
const H = 92;
const PAD = { ...CHART_PAD, bottom: 16 };

const LANES: Array<{ kind: FlightKind; label: string }> = [
  { kind: "takeoff", label: "TO" },
  { kind: "touchdown", label: "Land" },
  { kind: "fall", label: "Fall" },
];

function clockLabel(timeMs: number): string {
  return new Date(timeMs)
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })
    .replace(/\s/g, "")
    .toLowerCase();
}

function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function eventTitle(kind: FlightKind, timeMs: number, seg: FoilSegment): string {
  const when = clockLabel(timeMs);
  const dur = formatDuration(seg.durationSec);
  if (kind === "takeoff") return `Takeoff ${when} · ${dur} flight`;
  if (kind === "fall") return `Fall ${when} · ${dur} flight`;
  return `Touchdown ${when} · ${dur} flight`;
}

export function SessionFoilChart({
  analysis,
  samples,
  sampleIndex,
  onSelectSample,
}: Props) {
  const chart = useMemo(() => {
    if (samples.length === 0) return null;

    const innerH = H - PAD.top - PAD.bottom;
    const n = samples.length;
    const axis = buildTimeAxis(n);
    const { barW, xBar, xCenter } = axis;
    const baseline = PAD.top + innerH;
    const selectedTimeMs = samples[sampleIndex]?.timeMs ?? null;
    const laneH = innerH / LANES.length;
    const laneY = (kind: FlightKind) => {
      const i = LANES.findIndex((l) => l.kind === kind);
      return PAD.top + laneH * ((i < 0 ? 0 : i) + 0.5);
    };

    const bands = analysis.segments.map((seg, i) => {
      const x0 = xAtTimeMs(seg.startTimeMs, samples, xCenter);
      const x1 = xAtTimeMs(seg.endTimeMs, samples, xCenter);
      const x = Math.min(x0, x1);
      return {
        key: `band-${seg.startIndex}-${i}`,
        x,
        w: Math.max(2.4, Math.abs(x1 - x0)),
        selected:
          selectedTimeMs != null &&
          selectedTimeMs >= seg.startTimeMs &&
          selectedTimeMs <= seg.endTimeMs,
      };
    });

    const marks = analysis.segments.flatMap((seg, i) => {
      const items: Array<{
        key: string;
        kind: FlightKind;
        timeMs: number;
        x: number;
        y: number;
        selected: boolean;
        title: string;
        mark: string;
      }> = [
        {
          key: `takeoff-${seg.startIndex}-${i}`,
          kind: "takeoff",
          timeMs: seg.startTimeMs,
          x: xAtTimeMs(seg.startTimeMs, samples, xCenter),
          y: laneY("takeoff"),
          selected:
            selectedTimeMs != null &&
            Math.abs(selectedTimeMs - seg.startTimeMs) < 2500,
          title: eventTitle("takeoff", seg.startTimeMs, seg),
          mark: "↑",
        },
      ];
      if (seg.endKind === "fall" || seg.endKind === "touchdown") {
        const kind: FlightKind = seg.endKind;
        items.push({
          key: `${kind}-${seg.endIndex}-${i}`,
          kind,
          timeMs: seg.endTimeMs,
          x: xAtTimeMs(seg.endTimeMs, samples, xCenter),
          y: laneY(kind),
          selected:
            selectedTimeMs != null &&
            Math.abs(selectedTimeMs - seg.endTimeMs) < 2500,
          title: eventTitle(kind, seg.endTimeMs, seg),
          mark: kind === "fall" ? "×" : "↓",
        });
      }
      return items;
    });

    return {
      axis,
      barW,
      xBar,
      lanes: LANES.map((l) => ({ ...l, y: laneY(l.kind) })),
      bands,
      marks,
      baseline,
      innerH,
    };
  }, [analysis.segments, samples, sampleIndex]);

  if (!chart) return null;

  return (
    <div className="session-foil-chart forecast-plot">
      <div className="forecast-plot-rail">
        <span aria-hidden />
        <span className="forecast-plot-unit">on foil</span>
        <span className="forecast-plot-title">Flights</span>
      </div>
      <svg
        className="wind-chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label="Takeoffs, touchdowns, and falls along the session"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onSelectSample(
            chart.axis.indexFromClientX(
              e.clientX - rect.left,
              rect.width,
              samples.length,
            ),
          );
        }}
      >
        {chart.bands.map((b) => (
          <rect
            key={b.key}
            x={b.x}
            y={PAD.top}
            width={b.w}
            height={chart.innerH}
            className={
              b.selected ? "session-foil-band is-active" : "session-foil-band"
            }
          />
        ))}
        {chart.lanes.map((l) => (
          <g key={l.kind}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={l.y}
              y2={l.y}
              className="session-maneuver-lane"
            />
            <text
              x={PAD.left - 4}
              y={l.y + 3}
              className="wind-chart-tick"
              textAnchor="end"
            >
              {l.label}
            </text>
          </g>
        ))}
        {samples[sampleIndex] && (
          <rect
            x={chart.xBar(sampleIndex) - 0.6}
            y={PAD.top}
            width={chart.barW + 1.2}
            height={chart.innerH}
            className="wind-chart-selection"
          />
        )}
        {chart.marks.map((p) => (
          <g
            key={p.key}
            className={`session-foil-mark is-${p.kind}`}
            transform={`translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectSample(nearestIndexByTime(samples, p.timeMs));
            }}
          >
            <title>{p.title}</title>
            <line
              x1={0}
              x2={0}
              y1={chart.baseline - p.y}
              y2={6}
              className="session-maneuver-stem"
            />
            <circle r={10} fill="transparent" />
            <circle
              r={p.selected ? 8 : 6.2}
              className={
                p.selected ? "session-foil-dot selected" : "session-foil-dot"
              }
            />
            <text
              className="session-maneuver-letter"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {p.mark}
            </text>
          </g>
        ))}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={chart.baseline}
          y2={chart.baseline}
          className="wind-chart-baseline"
        />
        {analysis.segments.length === 0 && (
          <text
            x={(PAD.left + W - PAD.right) / 2}
            y={PAD.top + chart.innerH / 2}
            className="session-maneuver-empty"
            textAnchor="middle"
          >
            No flights detected
          </text>
        )}
      </svg>
    </div>
  );
}
