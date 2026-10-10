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
  /** Only comparable laps count towards bests, medians and the optimum; the others are shown. */
  comparable: boolean;
  /** Per segment: false where a car was within 1 s ahead or the lap sat in a tow. Such a time is shown but does not count, or "where to practise" would measure the other cars. Absent where it cannot be told (game sectors, a lap with no field). */
  alone?: boolean[];
  /** Seconds in each segment, in segment order; null where the segment does not count for this lap. */
  timesS: (number | null)[];
  /** A pit stop was entered on this lap (the grid marks it); absent reads as false. */
  stop?: boolean;
  /** The lap as the tables name it: "L5". */
  label?: string;
}

export interface SegmentTimes {
  segments: Segment[];
  /** Every lap cut at these segments, in lap order. */
  laps: SegmentLap[];
}

export interface SegmentStats {
  /** Times that counted for this segment. */
  n: number;
  /** All null under MIN_OPTIMUM_LAPS. */
  bestS: number | null;
  medianS: number | null;
  /** p75 − p25 of the times: robust to one bad lap, unlike a deviation. */
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

/** Whether lap's time in segment i counts towards bests, medians, spread and the optimum. */
function counts(lap: SegmentLap, i: number): number | null {
  const t = lap.timesS[i];
  if (!lap.comparable || lap.alone?.[i] === false) return null;
  return t != null && Number.isFinite(t) ? t : null;
}

function percentile(sorted: number[], p: number): number {
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/**
 * Best, median and spread of one column over exactly these times (null
 * skipped). Unlike segmentStats: no traffic filter, no minimum count, so one
 * ticked lap gives its own time as the median. The session grid uses this for
 * the ticked laps; the optimum and the session table keep segmentStats.
 */
export function columnStats(timesS: readonly (number | null)[]): SegmentStats {
  const xs = timesS.filter((t): t is number => t != null && Number.isFinite(t));
  if (xs.length === 0) return {n: 0, bestS: null, medianS: null, spreadS: null};
  xs.sort((a, b) => a - b);
  return {
    n: xs.length,
    bestS: xs[0],
    medianS: percentile(xs, 0.5),
    spreadS: percentile(xs, 0.75) - percentile(xs, 0.25),
  };
}

/** Best, median and spread of each segment over `laps`. */
export function segmentStats(times: SegmentTimes): SegmentStats[] {
  return times.segments.map((_, i) => {
    const xs: number[] = [];
    for (const lap of times.laps) {
      const t = counts(lap, i);
      if (t != null) xs.push(t);
    }
    if (xs.length < MIN_OPTIMUM_LAPS)
      return {n: xs.length, bestS: null, medianS: null, spreadS: null};
    xs.sort((a, b) => a - b);
    return {
      n: xs.length,
      bestS: xs[0],
      medianS: percentile(xs, 0.5),
      spreadS: percentile(xs, 0.75) - percentile(xs, 0.25),
    };
  });
}

/** Each segment's fastest time among the comparable laps, whatever their number; null where none counted. */
export function segmentBests(times: SegmentTimes): (number | null)[] {
  return times.segments.map((_, i) => {
    let best: number | null = null;
    for (const lap of times.laps) {
      const t = counts(lap, i);
      if (t != null && (best == null || t < best)) best = t;
    }
    return best;
  });
}

/** Best and median sections summed, per stint: the stints' optimal laps. */
export function segmentOptimum(times: SegmentTimes): StintOptimum[] {
  const laps: OptimumLap[] = times.laps
    .filter(l => l.comparable)
    .map(l => ({
      id: l.id,
      stint: l.stint,
      windowsS: l.timesS.map((_, i) => counts(l, i)),
    }));
  return sectionOptimum(laps, times.segments.length);
}
