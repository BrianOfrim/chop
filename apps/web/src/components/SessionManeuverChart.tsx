import { useMemo } from "react";
import { CHART_PAD, CHART_W, buildTimeAxis, xAtTimeMs } from "../lib/forecastChart";
import {
  nearestIndexByTime,
  type FoilAnalysis,
  type Maneuver,
  type ManeuverType,
} from "../lib/foilAnalysis";
import type { SessionSample } from "../lib/sessionTrack";

type Props = {
  analysis: FoilAnalysis;
  samples: SessionSample[];
  sampleIndex: number;
  onSelectSample: (index: number) => void;
};

const W = CHART_W;
const H = 92;
const PAD = { ...CHART_PAD, bottom: 16 };

const LANE_ORDER: Array<{ type: ManeuverType; label: string; mark: string }> = [
  { type: "tack", label: "Tack", mark: "T" },
  { type: "jibe", label: "Jibe", mark: "J" },
  { type: "transition", label: "Turn", mark: "↕" },
];

function clockLabel(timeMs: number): string {
  return new Date(timeMs)
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })
    .replace(/\s/g, "")
    .toLowerCase();
}

function maneuverTitle(m: Maneuver): string {
  const type =
    m.type === "tack" ? "Tack" : m.type === "jibe" ? "Jibe" : "Turn";
  return `${type} ${clockLabel(m.timeMs)} · ${m.side} · ${m.success ? "made" : "failed"}`;
}

function markFor(type: ManeuverType): string {
  return LANE_ORDER.find((l) => l.type === type)?.mark ?? "·";
}

export function SessionManeuverChart({
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

    const present = new Set(analysis.maneuvers.map((m) => m.type));
    const lanes = LANE_ORDER.filter((l) =>
      l.type === "transition" ? present.has("transition") : true,
    );
    const laneH = innerH / lanes.length;
    const laneY = (type: ManeuverType) => {
      const i = lanes.findIndex((l) => l.type === type);
      return PAD.top + laneH * ((i < 0 ? 0 : i) + 0.5);
    };

    const marks = analysis.maneuvers.map((m) => {
      const y0 = laneY(m.type);
      const side = m.side === "port" ? -1 : 1;
      return {
        key: `${m.type}-${m.timeMs}-${m.index}`,
        m,
        x: xAtTimeMs(m.timeMs, samples, xCenter),
        y: y0 + side * Math.min(7, laneH * 0.22),
        selected:
          selectedTimeMs != null && Math.abs(selectedTimeMs - m.timeMs) < 2500,
        title: maneuverTitle(m),
        mark: markFor(m.type),
      };
    });

    return {
      axis,
      barW,
      xBar,
      lanes: lanes.map((l) => ({ ...l, y: laneY(l.type) })),
      marks,
      baseline,
      innerH,
    };
  }, [analysis.maneuvers, samples, sampleIndex]);

  if (!chart) return null;

  return (
    <div className="session-maneuver-chart forecast-plot">
      <div className="forecast-plot-rail">
        <span aria-hidden />
        <span className="forecast-plot-unit">T / J</span>
        <span className="forecast-plot-title">Maneuvers</span>
      </div>
      <svg
        className="wind-chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label="Tacks and jibes along the session"
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
        {chart.lanes.map((l) => (
          <g key={l.type}>
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
            className={
              p.m.success
                ? "session-maneuver-mark is-made"
                : "session-maneuver-mark is-failed"
            }
            transform={`translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectSample(nearestIndexByTime(samples, p.m.timeMs));
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
                p.selected
                  ? "session-maneuver-dot selected"
                  : "session-maneuver-dot"
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
        {analysis.maneuvers.length === 0 && (
          <text
            x={(PAD.left + W - PAD.right) / 2}
            y={PAD.top + chart.innerH / 2}
            className="session-maneuver-empty"
            textAnchor="middle"
          >
            No tacks or jibes detected
          </text>
        )}
      </svg>
    </div>
  );
}
