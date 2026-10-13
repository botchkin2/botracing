// The one place a median, a quantile and a spread are computed (decisions/lap/
// 2026-10-11-selection-and-numbers.md: one definition of each, so a set of laps
// gives the same number on every screen). Callers decide WHICH values count
// (the ticked laps, a stint, the windows that count); this decides how a set
// of values becomes a number. Pure; no imports (the uploader runs it as is).

/** A value that may be missing: skipped, never counted as 0. */
export type Sample = number | null | undefined;

/** Fewest values a spread (IQR) is shown for: one value has no spread, and 0 would say it was perfectly consistent. */
export const MIN_SPREAD_N = 2;

/** The finite values of `values`, ascending. */
export function sortedFinite(values: readonly Sample[]): number[] {
  const out: number[] = [];
  for (const v of values) if (v != null && Number.isFinite(v)) out.push(v);
  return out.sort((a, b) => a - b);
}

/** Quantile q (0..1) of ascending values, interpolating between neighbours; NaN when empty. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/** Quantile q of `values` (missing skipped); null with no value. */
export function percentile(
  values: readonly Sample[],
  q: number,
): number | null {
  const s = sortedFinite(values);
  return s.length === 0 ? null : quantile(s, q);
}

/** The median of `values` (missing skipped); null with no value. */
export function median(values: readonly Sample[]): number | null {
  return percentile(values, 0.5);
}

/** p75 - p25 of `values` (missing skipped): robust to one bad lap, unlike a deviation. Null under MIN_SPREAD_N values. */
export function iqr(values: readonly Sample[]): number | null {
  const s = sortedFinite(values);
  return s.length < MIN_SPREAD_N ? null : quantile(s, 0.75) - quantile(s, 0.25);
}
