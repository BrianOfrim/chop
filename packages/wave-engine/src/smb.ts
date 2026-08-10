/** Gravity (m/s²). */
export const G = 9.81;

/**
 * Sverdrup–Munk–Bretschneider fetch-limited significant wave height (m).
 * Matches the method used for Pigeon Lake wave maps.
 */
export function smbHs(uMps: number, fetchM: number): number {
  if (!(uMps > 0) || !(fetchM > 0)) return 0;
  const fetch = Math.max(fetchM, 1);
  const dim = (G * fetch) / (uMps * uMps);
  return 0.283 * ((uMps * uMps) / G) * Math.tanh(0.0125 * Math.pow(dim, 0.42));
}

/** Depth-limited cap: Hs ≤ 0.4 × depth. */
export function depthLimitHs(hsM: number, depthM: number): number {
  const d = Math.max(depthM, 0.5);
  return Math.min(hsM, 0.4 * d);
}

export function smbHsDepthLimited(
  uMps: number,
  fetchM: number,
  depthM: number,
): number {
  return depthLimitHs(smbHs(uMps, fetchM), depthM);
}
