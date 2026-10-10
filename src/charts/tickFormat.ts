// Tick labels for chart axes. Each takes the value and the decimals its scale
// step needs (see scale.ts), so the labels line up with the ticks. The minus
// sign is the true one (−), as in the design handoff's gap format.

const MINUS = '−';

/** Signed seconds: "+0.25 s", "0.00 s", "−0.50 s". */
export function signedSeconds(v: number, decimals: number): string {
  const body = Math.abs(v).toFixed(decimals);
  const sign = v > 0 ? '+' : v < 0 ? MINUS : '';
  return `${sign}${body} s`;
}

/**
 * A lap time from seconds with one decimal: "1:23.5", "59.9" under a minute,
 * a negative time with the minus sign. Rounds to tenths first, so 59.96 reads
 * "1:00.0", never "0:60.0".
 */
export function lapTimeTenths(v: number): string {
  const sign = v < 0 ? MINUS : '';
  const tenths = Math.round(Math.abs(v) * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = tenths - minutes * 600;
  const seconds = (rest / 10).toFixed(1).padStart(4, '0');
  return minutes > 0
    ? `${sign}${minutes}:${seconds}`
    : `${sign}${(rest / 10).toFixed(1)}`;
}

/** A plain number with a unit: "100 %", "20 km/h". */
export function withUnit(unit: string) {
  return (v: number, decimals: number): string =>
    `${v.toFixed(decimals)} ${unit}`;
}
