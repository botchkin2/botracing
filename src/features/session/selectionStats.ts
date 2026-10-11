// The Session numbers that compare laps, all over one set: the ticked laps
// (decisions/lap/2026-10-11-selection-and-numbers.md). Facts about what
// happened (laps, comparable, best, the session median, fuel) are the
// session's and live in model.ts; every median, best mark, IQR, gap and the
// per-stint Optimal / Median / Inconsistency come from here, so the grid head,
// the table under it, the lap gaps, the bars and the stint lines give one
// answer. "Spread" is one statistic everywhere: the IQR (p75 - p25), named so.
// Pure.
import {
  columnStats,
  type SegmentStats,
  type SegmentTimes,
} from '@/src/analysis/segments';
import {
  MIN_OPTIMUM_LAPS,
  type OptimumLap,
  sectionOptimum,
} from '@/src/analysis/sectionOptimum';
import type {Lap} from '@/src/data/sessions';

/**
 * The laps the numbers describe: the ticked ones, or every comparable lap when
 * none is ticked (the lap strip's rule, src/state/lapSelection.ts), so an
 * empty selection still reads.
 */
export function basisOf<L extends {id: string; comparable: boolean}>(
  laps: readonly L[],
  ticked: ReadonlySet<string>,
): L[] {
  const picked = laps.filter(l => ticked.has(l.id));
  return picked.length > 0 ? picked : laps.filter(l => l.comparable);
}

/** Median, best and IQR of the lap times of `laps`; untimed laps skipped. */
export function lapTimeStats(laps: readonly Lap[]): SegmentStats {
  return columnStats(laps.map(l => l.timeS));
}

/**
 * Each segment's median, best and IQR over the basis laps: the grid head, the
 * desktop table under the lap list and the best-cell marks all read this.
 */
export function segmentBasisStats(
  times: SegmentTimes,
  basis: ReadonlySet<string>,
): SegmentStats[] {
  const picked = times.laps.filter(l => basis.has(l.id));
  return times.segments.map((_, i) =>
    columnStats(picked.map(l => l.timesS[i] ?? null)),
  );
}

export type StintNumbers = {
  stint: number;
  /** Basis laps in this stint. */
  n: number;
  /** Their lap times: the stint line's median and IQR. */
  lapTimes: SegmentStats;
  /** Best segments of the basis laps summed; null under MIN_OPTIMUM_LAPS a segment, or a segment with no time. */
  optimalS: number | null;
  /** Median minus Optimal; null without both. */
  inconsistencyS: number | null;
};

/**
 * One entry per stint with basis laps, in stint order. Optimal needs every
 * segment timed on MIN_OPTIMUM_LAPS basis laps of the stint: a sum with a hole
 * is not a lap. Median is the median lap time of the same laps, a time that
 * was driven, so Inconsistency is how far the middle of the stint sits from
 * its best sections joined up.
 */
export function stintNumbers(
  laps: readonly Lap[],
  basis: ReadonlySet<string>,
  times: SegmentTimes | null,
): StintNumbers[] {
  const stints = [...new Set(laps.map(l => l.stint))].sort((a, b) => a - b);
  const optimumLaps: OptimumLap[] = (times?.laps ?? [])
    .filter(l => basis.has(l.id))
    .map(l => ({id: l.id, stint: l.stint, windowsS: l.timesS}));
  const optimum = times
    ? sectionOptimum(optimumLaps, times.segments.length)
    : [];
  const out: StintNumbers[] = [];
  for (const stint of stints) {
    const picked = laps.filter(l => l.stint === stint && basis.has(l.id));
    if (picked.length === 0) continue;
    const lapTimes = lapTimeStats(picked);
    const optimalS =
      picked.length >= MIN_OPTIMUM_LAPS
        ? optimum.find(o => o.stint === stint)?.bestSumS ?? null
        : null;
    out.push({
      stint,
      n: picked.length,
      lapTimes,
      optimalS,
      inconsistencyS:
        optimalS != null && lapTimes.medianS != null
          ? lapTimes.medianS - optimalS
          : null,
    });
  }
  return out;
}
