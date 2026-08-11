type Props = {
  gradient: string;
  labels: [string, string, string];
  unit: string;
  className?: string;
};

/** Compact horizontal color ramp with min / mid / max labels. */
export function ColorScaleLegend({
  gradient,
  labels,
  unit,
  className,
}: Props) {
  return (
    <span
      className={className ? `color-scale-legend ${className}` : "color-scale-legend"}
      title={`${labels[0]}–${labels[2]} ${unit}`}
    >
      <span className="color-scale-bar" style={{ background: gradient }} />
      <span className="color-scale-labels">
        <span>{labels[0]}</span>
        <span>{labels[1]}</span>
        <span>
          {labels[2]} {unit}
        </span>
      </span>
    </span>
  );
}
