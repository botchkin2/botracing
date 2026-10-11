// The phone Session's line under the lap-time chart: per stint, the optimal lap
// (best of every section summed), the median lap (median of every section
// summed) and the gap between them (Σ median − best), with the laps behind it.
// Same stints as optimumFacts (src/analysis/sectionOptimum.ts), shaped as one
// line each: "Optimal 1:19.976 · Median 1:20.759 · +0.782 s". Neither lap was
// driven and none is a target (CODE_STANDARDS §7).
import {type StintOptimum} from '@/src/analysis/sectionOptimum';
import {formatLapTime} from '@/src/design';

export type OptimumLine = {
  /** "Stint 2"; null when the session is one stint. */
  label: string | null;
  optimal: string;
  median: string;
  /** Median minus optimal, signed: "+0.782 s". */
  inconsistency: string;
  /** "19 laps": what the numbers are over. */
  laps: string;
};

/** One line per stint with enough laps; none before the sectors or under the floor. */
export function optimumLines(
  stints: StintOptimum[],
  stintCount: number,
): OptimumLine[] {
  const lines: OptimumLine[] = [];
  for (const s of stints) {
    if (s.bestSumS == null || s.medianSumS == null) continue;
    lines.push({
      label: stintCount > 1 ? `Stint ${s.stint}` : null,
      optimal: formatLapTime(s.bestSumS),
      median: formatLapTime(s.medianSumS),
      inconsistency: `+${(s.medianSumS - s.bestSumS).toFixed(3)} s`,
      laps: `${s.lapCount} laps`,
    });
  }
  return lines;
}
