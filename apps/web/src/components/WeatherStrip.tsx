import { useMemo } from "react";
import type { WindHour } from "../lib/wind";
import {
  CHART_PAD,
  CHART_W,
  buildDaySegs,
  buildTimeAxis,
} from "../lib/forecastChart";
import {
  formatPrecipShort,
  formatWeatherHour,
  isThunder,
  weatherKind,
  type WeatherKind,
} from "../lib/weather";

type Props = {
  hours: WindHour[];
  hourIndex: number;
  onSelectHour: (index: number) => void;
};

const W = CHART_W;
const H = 38;
const PAD = CHART_PAD;
const PRECIP_BAR_MAX_MM = 4;
const PRECIP_BAR_H = 6;

const KIND_FILL: Record<WeatherKind, string> = {
  clear: "#d9a21a",
  partly: "#b89a48",
  cloudy: "#7a8680",
  fog: "#8d9494",
  drizzle: "#5a8aa0",
  rain: "#2a6f9a",
  snow: "#6a8aaa",
  thunder: "#d45a12",
};

function WxGlyph({
  kind,
  thunder,
}: {
  kind: WeatherKind;
  thunder: boolean;
}) {
  const fill = thunder ? KIND_FILL.thunder : KIND_FILL[kind];
  if (thunder) {
    return (
      <g>
        <path
          d="M-3.4,-1.1 C-3.4,-2.8 -2.1,-4.1 -0.4,-4.1 C0.2,-5.4 1.7,-6.2 3.2,-5.8 C4.6,-5.4 5.5,-4.1 5.5,-2.7 C6.8,-2.5 7.6,-1.3 7.4,0 C7.2,1.3 6,2.1 4.7,2.1 H-2.2 C-3.6,2.1 -4.5,0.8 -3.4,-1.1 Z"
          fill={fill}
        />
        <path d="M1.1,-0.2 L-1.6,3.4 H0.4 L-0.6,6.4 L2.8,2.2 H0.7 Z" fill="#f4d36a" />
      </g>
    );
  }
  switch (kind) {
    case "clear":
      return <circle r="3.3" fill={fill} />;
    case "partly":
      return (
        <g>
          <circle cx="-1.6" cy="-1.8" r="2.6" fill="#d9a21a" />
          <path
            d="M-3.2,0.4 C-3.1,-1.1 -1.8,-2.2 -0.3,-2.1 C0.4,-3.2 1.8,-3.7 3.1,-3.2 C4.3,-2.8 5.1,-1.6 5.0,-0.4 C6.1,-0.2 6.8,0.9 6.5,2.0 C6.2,3.1 5.1,3.8 4.0,3.7 H-1.8 C-3.1,3.7 -3.9,2.4 -3.2,0.4 Z"
            fill={fill}
          />
        </g>
      );
    case "fog":
      return (
        <g stroke={fill} strokeWidth="1.15" strokeLinecap="round">
          <line x1="-4.2" y1="-2.2" x2="4.2" y2="-2.2" />
          <line x1="-3.2" y1="0" x2="3.2" y2="0" />
          <line x1="-4.2" y1="2.2" x2="4.2" y2="2.2" />
        </g>
      );
    case "drizzle":
    case "rain":
      return (
        <g>
          <path
            d="M-3.4,-2.4 C-3.3,-3.9 -2.0,-5.0 -0.5,-4.9 C0.2,-6.0 1.6,-6.5 2.9,-6.0 C4.1,-5.6 4.9,-4.4 4.8,-3.2 C5.9,-3.0 6.6,-1.9 6.3,-0.8 C6.0,0.3 4.9,1.0 3.8,0.9 H-2.0 C-3.3,0.9 -4.1,-0.4 -3.4,-2.4 Z"
            fill={fill}
          />
          <g fill={fill}>
            <circle cx="-1.2" cy="3.3" r={kind === "rain" ? 0.85 : 0.65} />
            <circle cx="1.4" cy="4.4" r={kind === "rain" ? 0.85 : 0.65} />
            {kind === "rain" && <circle cx="0.1" cy="5.6" r="0.75" />}
          </g>
        </g>
      );
    case "snow":
      return (
        <g>
          <path
            d="M-3.4,-2.4 C-3.3,-3.9 -2.0,-5.0 -0.5,-4.9 C0.2,-6.0 1.6,-6.5 2.9,-6.0 C4.1,-5.6 4.9,-4.4 4.8,-3.2 C5.9,-3.0 6.6,-1.9 6.3,-0.8 C6.0,0.3 4.9,1.0 3.8,0.9 H-2.0 C-3.3,0.9 -4.1,-0.4 -3.4,-2.4 Z"
            fill={fill}
          />
          <g fill={fill}>
            <circle cx="-1.3" cy="3.4" r="0.7" />
            <circle cx="1.5" cy="4.2" r="0.7" />
            <circle cx="0.2" cy="5.5" r="0.7" />
          </g>
        </g>
      );
    default:
      return (
        <path
          d="M-4.0,-1.2 C-3.9,-3.0 -2.4,-4.4 -0.6,-4.3 C0.2,-5.8 1.9,-6.6 3.5,-6.1 C5.1,-5.6 6.1,-4.0 6.0,-2.4 C7.4,-2.1 8.4,-0.7 8.1,0.7 C7.8,2.1 6.4,3.0 5.0,2.9 H-2.4 C-4.0,2.9 -5.0,1.2 -4.0,-1.2 Z"
          fill={fill}
        />
      );
  }
}

export function WeatherStrip({ hours, hourIndex, onSelectHour }: Props) {
  const chart = useMemo(() => {
    if (hours.length === 0) return null;
    const n = hours.length;
    const axis = buildTimeAxis(n);
    const { slot, barW, xBar, xCenter } = axis;
    const times = hours.map((h) => h.time);
    const daySegs = buildDaySegs(times);
    const dayDividers = daySegs.slice(1).map((seg) => PAD.left + seg.start * slot);
    const iconSize = Math.max(5.2, Math.min(11, barW * 1.15));

    const cells = hours.map((h, i) => {
      const thunder = isThunder(h.weatherCode);
      const precip = h.precipMm;
      const wet = precip >= 0.05;
      return {
        i,
        x: xBar(i),
        cx: xCenter(i),
        kind: weatherKind(h.weatherCode),
        thunder,
        precip,
        wet,
        barH: wet
          ? Math.max(1.2, Math.min(PRECIP_BAR_H, (precip / PRECIP_BAR_MAX_MM) * PRECIP_BAR_H))
          : 0,
        title: formatWeatherHour(h.weatherCode, precip),
        selected: i === hourIndex,
      };
    });

    const minLabelGap = 16;
    const labels: Array<{ i: number; x: number; text: string }> = [];
    const wantLabel = (i: number) => {
      const c = cells[i]!;
      return c.wet && (c.selected || c.thunder || c.precip >= 0.2);
    };
    let lastX = -Infinity;
    for (const c of cells) {
      if (!wantLabel(c.i)) continue;
      const text = formatPrecipShort(c.precip);
      if (!text) continue;
      const force = c.selected || c.thunder;
      if (!force && c.cx - lastX < minLabelGap) continue;
      labels.push({ i: c.i, x: c.cx, text });
      lastX = c.cx;
    }

    return { axis, barW, cells, labels, dayDividers, iconSize };
  }, [hours, hourIndex]);

  if (!chart) return null;

  const iconY = 11;
  const barTop = 19;

  return (
    <div className="forecast-plot weather-strip">
      <div className="forecast-plot-rail">
        <span />
        <span />
        <span className="forecast-plot-title">Sky</span>
      </div>
      <svg
        className="wind-chart-svg weather-strip-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label="Hourly weather and precipitation"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onSelectHour(
            chart.axis.indexFromClientX(
              e.clientX - rect.left,
              rect.width,
              hours.length,
            ),
          );
        }}
      >
        {chart.dayDividers.map((x) => (
          <line
            key={`div-${x}`}
            x1={x}
            x2={x}
            y1={2}
            y2={H - 2}
            className="wind-chart-day-div"
          />
        ))}
        {chart.cells[hourIndex] && (
          <rect
            x={chart.cells[hourIndex]!.x - 0.6}
            y={2}
            width={chart.barW + 1.2}
            height={H - 4}
            className="wind-chart-selection"
          />
        )}
        {chart.cells.map((c) => (
          <g key={c.i} className={c.selected ? "wx-hour selected" : "wx-hour"}>
            <title>{c.title}</title>
            {c.thunder && (
              <rect
                x={c.x}
                y={2}
                width={chart.barW}
                height={H - 4}
                className="wx-thunder-bg"
                rx={0.6}
              />
            )}
            <g transform={`translate(${c.cx.toFixed(1)},${iconY}) scale(${(chart.iconSize / 12).toFixed(3)})`}>
              <WxGlyph kind={c.kind} thunder={c.thunder} />
            </g>
            {c.wet && (
              <rect
                x={c.x}
                y={barTop + PRECIP_BAR_H - c.barH}
                width={chart.barW}
                height={c.barH}
                className={c.thunder ? "wx-precip-bar thunder" : "wx-precip-bar"}
                rx={0.5}
              />
            )}
          </g>
        ))}
        {chart.labels.map((l) => (
          <text
            key={`p-${l.i}`}
            x={l.x}
            y={H - 3}
            className={
              hours[l.i] && isThunder(hours[l.i]!.weatherCode)
                ? "wx-precip-label thunder"
                : "wx-precip-label"
            }
            textAnchor="middle"
          >
            {l.text}
          </text>
        ))}
      </svg>
    </div>
  );
}
