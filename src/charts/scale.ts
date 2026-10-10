// One scale for every chart. A fixed scale is a physical range the data cannot
// change; a fitted scale covers the values in the selection, in 1-2-5 steps,
// so one outlier stretches it no more than the step allows. A value outside the
// scale is clipped at the edge, never fitted. Pure: no React.

export type Tick = {v: number; label: string};

export type Scale = {lo: number; hi: number; step: number; ticks: Tick[]};

/** Labels a tick: the value and the decimals its step needs. */
export type LabelFormat = (v: number, decimals: number) => string;

/** Most ticks a scale may show, unless a caller asks for fewer. */
export const MAX_TICKS = 8;

/** Used when nothing is finite to fit: a unit range either side of zero. */
const EMPTY: {lo: number; hi: number} = {lo: -1, hi: 1};

/** A physical range, as given. The data does not change it. */
export function fixedScale(
  lo: number,
  hi: number,
  step: number,
  format?: LabelFormat,
): Scale {
  return {lo, hi, step, ticks: ticksOf(lo, hi, step, format)};
}

/**
 * The smallest 1-2-5 step (1, 2, 5, 10, 20, 50, … and 0.1, 0.2, 0.5, …) that
 * shows `span` in at most `maxTicks` ticks.
 */
export function niceStep(span: number, maxTicks = MAX_TICKS): number {
  for (let exp = -6; exp <= 6; exp++) {
    for (const m of [1, 2, 5]) {
      const step = m * 10 ** exp;
      if (span / step <= maxTicks - 1) return step;
    }
  }
  return 10 ** 6;
}

/**
 * A scale that covers the finite values, rounded out to whole steps. The step
 * is chosen on the rounded range, so the ticks shown never exceed `maxTicks`.
 * `symmetric` centres it on zero (for differences), and a flat set still gets
 * room either side of zero or of its value.
 */
export function fitScale(
  values: readonly number[],
  opts: {symmetric: boolean; maxTicks?: number; format?: LabelFormat},
): Scale {
  const maxTicks = opts.maxTicks ?? MAX_TICKS;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return fixedScale(
      EMPTY.lo,
      EMPTY.hi,
      niceStep(EMPTY.hi - EMPTY.lo, maxTicks),
    );
  }
  if (opts.symmetric) {
    const m = Math.max(Math.abs(min), Math.abs(max));
    min = -m;
    max = m;
  }
  // A flat set has no span to step over; a unit span gives it room.
  const span = max - min || 1;
  let step = niceStep(span, maxTicks);
  let lo = stepsDown(min / step) * step;
  let hi = stepsUp(max / step) * step;
  // Rounding out can add ticks; take the next step up until they fit.
  while ((hi - lo) / step > maxTicks - 1) {
    step = nextStep(step);
    lo = stepsDown(min / step) * step;
    hi = stepsUp(max / step) * step;
  }
  if (opts.symmetric) {
    // Centre on zero: the same number of steps either side, at least one.
    const edge = Math.max(
      1,
      stepsUp(Math.max(Math.abs(lo), Math.abs(hi)) / step),
    );
    lo = -edge * step;
    hi = edge * step;
  }
  if (hi - lo < step) hi = lo + step;
  lo = round(lo);
  hi = round(hi);
  return {lo, hi, step, ticks: ticksOf(lo, hi, step, opts.format)};
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

/** The 1-2-5 step after `step`. */
function nextStep(step: number): number {
  const exp = Math.floor(Math.log10(step) + 1e-9);
  const mantissa = Math.round(step / 10 ** exp);
  const seq = [1, 2, 5];
  const i = seq.indexOf(mantissa);
  return i >= 0 && i < seq.length - 1
    ? round(seq[i + 1] * 10 ** exp)
    : round(10 ** (exp + 1));
}

function ticksOf(
  lo: number,
  hi: number,
  step: number,
  format?: LabelFormat,
): Tick[] {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const ticks: Tick[] = [];
  for (let i = 0; lo + i * step <= hi + step * 1e-6; i++) {
    const v = round(lo + i * step);
    ticks.push({v, label: format ? format(v, decimals) : v.toFixed(decimals)});
  }
  return ticks;
}

// Floating-point steps (0.1 + 0.2) drift; round to a dp well inside a step.
function round(x: number): number {
  return Number(x.toFixed(10));
}

// Division of floats lands a hair off a whole step (0.6 / 0.2 is 3.0000000004);
// a tolerance keeps that from adding a step.
const EPS = 1e-9;
function stepsUp(x: number): number {
  return Math.ceil(x - EPS);
}
function stepsDown(x: number): number {
  return Math.floor(x + EPS);
}
