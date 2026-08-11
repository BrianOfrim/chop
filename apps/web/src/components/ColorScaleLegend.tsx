type Props = {
  gradient: string;
  labels: [string, string, string];
  unit: string;
  orientation?: "horizontal" | "vertical";
  className?: string;
};

/** Compact color ramp with min / mid / max labels. */
export function ColorScaleLegend({
  gradient,
  labels,
  unit,
  orientation = "horizontal",
  className,
}: Props) {
  const vertical = orientation === "vertical";
  const ordered = vertical ? [labels[2], labels[1], labels[0]] : labels;
  return (
    <span
      className={[
        "color-scale-legend",
        vertical ? "vertical" : null,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      title={`${labels[0]}–${labels[2]} ${unit}`}
    >
      <span className="color-scale-bar" style={{ background: gradient }} />
      <span className="color-scale-labels">
        <span>
          {ordered[0]}
          {vertical ? ` ${unit}` : ""}
        </span>
        <span>{ordered[1]}</span>
        <span>
          {ordered[2]}
          {vertical ? "" : ` ${unit}`}
        </span>
      </span>
    </span>
  );
}