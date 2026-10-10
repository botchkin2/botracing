// Where a series first leaves its scale, for the clip marker. The marker sits
// on the edge it left by, at that point's x, so the reader sees a trace
// running off the chart rather than a silent cut.

export type Exit = {index: number; edge: 'top' | 'bottom'};

/**
 * The first index in [from, to] whose value is outside [lo, hi], and the edge
 * it left by. Missing values are skipped. Null when the series stays inside.
 */
export function firstExit(
  values: readonly number[],
  from: number,
  to: number,
  lo: number,
  hi: number,
): Exit | null {
  const last = Math.min(to, values.length - 1);
  for (let i = Math.max(0, from); i <= last; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v > hi) return {index: i, edge: 'top'};
    if (v < lo) return {index: i, edge: 'bottom'};
  }
  return null;
}
