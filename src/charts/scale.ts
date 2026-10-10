// One scale for every chart. A fixed scale is a physical range the data
// cannot change; a time scale fits the comparable laps of the selection, in
// nice steps, so one outlier never stretches it. A value outside the scale is
// clipped at the edge, never fitted.

export type Scale = {lo: number; hi: number; step: number};

/** Steps a time scale may use, in seconds, smallest first. */
export const TIME_STEPS_S = [0.1, 0.25, 0.5, 1] as const;

/** The most ticks a time scale spans; a finer step is taken until it fits. */
const MAX_STEPS = 8;

/** Used when there is nothing to fit: a quarter-second step either side of 0. */
const EMPTY_TIME_SCALE: Scale = {lo: -0.5, hi: 0.5, step: 0.25};

/** A physical range, as given. The values do not change it. */
export function fixedScale(lo: number, hi: number, step: number): Scale {
  return {lo, hi, step};
}

/**
 * A time range (seconds) that covers the finite values, rounded out to the
 * smallest step that keeps it within MAX_STEPS. `symmetric` centres it on 0,
 * for differences, so a faster and a slower lap read the same either side.
 */
export function timeScale(
  values: readonly number[],
  opts: {symmetric: boolean},
): Scale {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return EMPTY_TIME_SCALE;

  const span = opts.symmetric
    ? 2 * Math.max(Math.abs(min), Math.abs(max))
    : max - min;
  const step =
    TIME_STEPS_S.find(s => span / s <= MAX_STEPS) ??
    TIME_STEPS_S[TIME_STEPS_S.length - 1];

  let lo: number;
  let hi: number;
  if (opts.symmetric) {
    const edge = Math.ceil(Math.max(Math.abs(min), Math.abs(max)) / step);
    lo = -edge * step;
    hi = edge * step;
  } else {
    lo = Math.floor(min / step) * step;
    hi = Math.ceil(max / step) * step;
  }
  // A flat set (one lap, or every lap at one time) still gets a step of room.
  if (hi - lo < step) hi = lo + step;
  return {lo: round(lo), hi: round(hi), step};
}

/** True when the value lies outside the scale, so it is drawn clipped. */
export function isClipped(v: number, s: Scale): boolean {
  return Number.isFinite(v) && (v < s.lo || v > s.hi);
}

/** The value held to the scale's edges; NaN stays NaN (no point to draw). */
export function clampToScale(v: number, s: Scale): number {
  if (!Number.isFinite(v)) return v;
  return Math.min(s.hi, Math.max(s.lo, v));
}

// Floating-point steps (0.1 + 0.2) drift; round to a dp well inside a step.
function round(x: number): number {
  return Number(x.toFixed(10));
}
