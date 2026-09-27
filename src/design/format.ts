// Number formats from the design handoff ("Units and formats"). Inputs are
// raw numbers in the unit named by the parameter; output is display text.

/** 99.733 → "1:39.733" */
export function formatLapTime(timeS: number): string {
  const totalMs = Math.round(timeS * 1000);
  const minutes = Math.floor(totalMs / 60000);
  const ms = totalMs - minutes * 60000;
  const seconds = (ms / 1000).toFixed(3).padStart(6, '0');
  return `${minutes}:${seconds}`;
}

/** Signed gap with 3 decimals: "+0.312", "−0.105". Uses a true minus sign. */
export function formatGap(deltaS: number, decimals = 3): string {
  const sign = deltaS > 0 ? '+' : deltaS < 0 ? '−' : '±';
  return `${sign}${Math.abs(deltaS).toFixed(decimals)}`;
}

/** Corner grid: 2 decimals, no leading zero: "+.21", "−1.04". */
export function formatCornerGap(deltaS: number): string {
  return formatGap(deltaS, 2).replace(/^([+−±])0\./, '$1.');
}

/** "2,150 m" */
export function formatDistance(distanceM: number): string {
  return `${Math.round(distanceM).toLocaleString('en-US')} m`;
}
