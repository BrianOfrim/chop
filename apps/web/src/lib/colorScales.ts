/** Named continuous color ramps used for wind speed and wave height. */

export type ColorScaleId =
  | "chop"
  | "breeze"
  | "viridis"
  | "magma"
  | "blues"
  | "thermal";

/** Stop: [t 0..1, r, g, b] */
export type ColorStop = readonly [number, number, number, number];

export type ColorScaleDef = {
  id: ColorScaleId;
  label: string;
  stops: readonly ColorStop[];
};

export const COLOR_SCALES: Record<ColorScaleId, ColorScaleDef> = {
  chop: {
    id: "chop",
    label: "Chop",
    stops: [
      [0.0, 8, 70, 92],
      [0.25, 18, 130, 140],
      [0.5, 70, 175, 150],
      [0.75, 220, 180, 70],
      [1.0, 255, 245, 210],
    ],
  },
  breeze: {
    id: "breeze",
    label: "Breeze",
    stops: [
      [0.0, 55, 70, 90],
      [0.25, 70, 120, 170],
      [0.5, 90, 165, 150],
      [0.75, 220, 170, 60],
      [1.0, 210, 90, 70],
    ],
  },
  viridis: {
    id: "viridis",
    label: "Viridis",
    stops: [
      [0.0, 68, 1, 84],
      [0.25, 59, 82, 139],
      [0.5, 33, 145, 140],
      [0.75, 94, 201, 98],
      [1.0, 253, 231, 37],
    ],
  },
  magma: {
    id: "magma",
    label: "Magma",
    stops: [
      [0.0, 0, 0, 4],
      [0.25, 80, 18, 123],
      [0.5, 182, 54, 121],
      [0.75, 251, 135, 97],
      [1.0, 252, 253, 191],
    ],
  },
  blues: {
    id: "blues",
    label: "Blues",
    stops: [
      [0.0, 247, 251, 255],
      [0.25, 198, 219, 239],
      [0.5, 107, 174, 214],
      [0.75, 33, 113, 181],
      [1.0, 8, 48, 107],
    ],
  },
  thermal: {
    id: "thermal",
    label: "Thermal",
    stops: [
      [0.0, 12, 51, 131],
      [0.25, 10, 136, 186],
      [0.5, 242, 211, 56],
      [0.75, 242, 143, 56],
      [1.0, 217, 30, 30],
    ],
  },
};

/** Wind chart uses thermal; wave/map Hs uses original chop. */
export const DEFAULT_WIND_SCALE: ColorScaleId = "thermal";
export const DEFAULT_WAVE_SCALE: ColorScaleId = "chop";

export function sampleRgb(
  scale: ColorScaleId,
  tRaw: number,
): [number, number, number] {
  const t = Math.max(0, Math.min(1, tRaw));
  const stops = COLOR_SCALES[scale].stops;
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1]![0]) i++;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  const u = (t - a[0]) / (b[0] - a[0] || 1);
  return [
    Math.round(a[1] + (b[1] - a[1]) * u),
    Math.round(a[2] + (b[2] - a[2]) * u),
    Math.round(a[3] + (b[3] - a[3]) * u),
  ];
}

/** Sample with opacity ramp suited to map/chart overlays. */
export function sampleRgba(
  scale: ColorScaleId,
  tRaw: number,
  alphaAt0 = 150,
  alphaAt1 = 255,
): [number, number, number, number] {
  const t = Math.max(0, Math.min(1, tRaw));
  const [r, g, b] = sampleRgb(scale, t);
  return [r, g, b, Math.round(alphaAt0 + (alphaAt1 - alphaAt0) * t)];
}

export function scaleGradientCss(
  scale: ColorScaleId,
  dir: "horizontal" | "vertical" = "horizontal",
): string {
  const stops = COLOR_SCALES[scale].stops;
  if (dir === "vertical") {
    const parts = [...stops]
      .reverse()
      .map(([t, r, g, b]) => `rgb(${r}, ${g}, ${b}) ${((1 - t) * 100).toFixed(0)}%`);
    return `linear-gradient(180deg, ${parts.join(", ")})`;
  }
  const parts = stops.map(
    ([t, r, g, b]) => `rgb(${r}, ${g}, ${b}) ${(t * 100).toFixed(0)}%`,
  );
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

export function rgbaCss(
  rgba: [number, number, number, number],
): string {
  const [r, g, b, a] = rgba;
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}
