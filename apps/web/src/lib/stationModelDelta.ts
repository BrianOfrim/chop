import { cardinalFromDeg } from "./wind";
import {
  formatWindSpeed,
  mpsToWind,
  windUnitLabel,
  type WindSpeedUnit,
} from "./units";

export type SampledWind = {
  speedMps: number;
  dirDeg: number;
};

/** Smallest signed heading change from `fromDeg` to `toDeg` in (-180, 180]. */
export function signedAngleDiffDeg(fromDeg: number, toDeg: number): number {
  const d = (((toDeg - fromDeg) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

function finiteNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

export function formatSignedWindSpeedDelta(
  stationMps: number,
  modelMps: number,
  unit: WindSpeedUnit,
): string {
  const digits = unit === "mps" ? 1 : 0;
  const station = Number(mpsToWind(stationMps, unit).toFixed(digits));
  const model = Number(mpsToWind(modelMps, unit).toFixed(digits));
  const rounded = Number((station - model).toFixed(digits));
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(digits)} ${windUnitLabel(unit)}`;
}

export function formatSignedAngleDelta(deltaDeg: number): string {
  const rounded = Math.round(deltaDeg);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}°`;
}

/**
 * Station observation minus modeled wind at the same point.
 * Positive speed = station stronger; positive direction = station FROM is clockwise of the model.
 */
export function formatStationModelWindDelta(
  stationSpeedMps: number | null,
  stationDirDeg: number | null,
  model: SampledWind | null | undefined,
  unit: WindSpeedUnit,
): string | null {
  if (
    !model ||
    !finiteNumber(model.speedMps) ||
    !finiteNumber(model.dirDeg)
  ) {
    return null;
  }

  const parts: string[] = [];
  if (finiteNumber(stationSpeedMps)) {
    parts.push(
      formatSignedWindSpeedDelta(stationSpeedMps, model.speedMps, unit),
    );
  }
  if (finiteNumber(stationDirDeg)) {
    parts.push(
      formatSignedAngleDelta(signedAngleDiffDeg(model.dirDeg, stationDirDeg)),
    );
  }
  if (parts.length === 0) return null;

  const modelLabel = `${formatWindSpeed(model.speedMps, unit)} from ${cardinalFromDeg(model.dirDeg)}`;
  return `Model ${modelLabel} · Δ ${parts.join(" · ")}`;
}
