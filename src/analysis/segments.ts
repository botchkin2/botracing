// The one shape every per-section table reads (decisions/lap/2026-10-04-
// sections-and-compare.md): a lap cut into segments, each with a label and a
// time per lap. Two producers fill it, our turn sections and the game's
// sectors (src/data/sessions/segments.ts); the optimum, the footer stats and
// every screen take a `SegmentTimes` and never branch on which one it is.
import {
  type OptimumLap,
  MIN_OPTIMUM_LAPS,
  sectionOptimum,
  type StintOptimum,
} from './sectionOptimum';

/** What the Settings toggle picks: our turn sections, or the game's three sectors. */
export type SectionMode = 'turns' | 'sectors';

export interface Segment {
  label: string;
  /** Where the segment sits on the lap, in the map's frame; null for the game's sectors, whose lines are not stored (only their times are). */
  range: {fromM: number; toM: number} | null;
}

export interface SegmentLap {
  id: string;
  stint: number;
  /** Seconds in each segment, in segment order; null where the segment does not count for this lap. */
  timesS: (number | null)[];
}

export interface SegmentTimes {
  segments: Segment[];
  /** Comparable laps only: the laps whose times may be summed or ranked. */
  laps: SegmentLap[];
}

export interface SegmentStats {
  /** Times that counted for this segment. */
  n: number;
  /** All null under MIN_OPTIMUM_LAPS. */
  bestS: number | null;
  medianS: number | null;
  /** p90 − p10 of the times. */
  spreadS: number | null;
}

/** "T4", or "T2–5" for a section of several corners. */
export function turnRangeLabel(corners: readonly string[]): string {
  if (corners.length === 0) return '';
  if (corners.length === 1) return corners[0];
  const last = corners[corners.length - 1];
  const first = corners[0];
  // "T2" and "T5" read "T2–5"; official names ("T10a") keep their prefix.
  const bare = /^T\d+$/.test(first) && /^T\d+$/.test(last);
  return `${first}–${bare ? last.slice(1) : last}`;
}

function percentile(sorted: number[], p: number): number {
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/** Best, median and spread of each segment over `laps`. */
export function segmentStats(times: SegmentTimes): SegmentStats[] {
  return times.segments.map((_, i) => {
    const xs: number[] = [];
    for (const lap of times.laps) {
      const t = lap.timesS[i];
      if (t != null && Number.isFinite(t)) xs.push(t);
    }
    if (xs.length < MIN_OPTIMUM_LAPS)
      return {n: xs.length, bestS: null, medianS: null, spreadS: null};
    xs.sort((a, b) => a - b);
    return {
      n: xs.length,
      bestS: xs[0],
      medianS: percentile(xs, 0.5),
      spreadS: percentile(xs, 0.9) - percentile(xs, 0.1),
    };
  });
}

/** Best and median sections summed, per stint: the stints' optimal laps. */
export function segmentOptimum(times: SegmentTimes): StintOptimum[] {
  const laps: OptimumLap[] = times.laps.map(l => ({
    id: l.id,
    stint: l.stint,
    windowsS: l.timesS,
  }));
  return sectionOptimum(laps, times.segments.length);
}
