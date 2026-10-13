// The one shape every per-section table reads (decisions/lap/2026-10-04-
// sections-and-compare.md): a lap cut into segments, each with a label and a
// time per lap. Two producers fill it, our turn sections and the game's
// sectors (src/data/sessions/segments.ts); the optimum, the column stats and
// every screen take a `SegmentTimes` and never branch on which one it is.

import {iqr, quantile, sortedFinite} from './setStats.ts';

/** What the Settings toggle picks: our turn sections, or the game's three sectors. */
export type SectionMode = 'turns' | 'sectors';

export interface Segment {
  label: string;
  /** The map section the window belongs to; null for the start straight and the game's sectors. */
  section?: number | null;
  /** A compound section (more than one corner): its cell opens Corner for the whole of it. */
  compound?: boolean;
  /** Where the segment sits on the lap, in the map's frame; null for the game's sectors, whose lines are not stored (only their times are). */
  range: {fromM: number; toM: number} | null;
}

export interface SegmentLap {
  id: string;
  stint: number;
  /** The default basis when no lap is ticked (src/features/session/selectionStats.ts). Tow and traffic never remove a time: they are flags (Botkin, 2026-10-01). */
  comparable: boolean;
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
  /** All null with no time. */
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

/**
 * Best, median and IQR of one column over exactly these times (null skipped):
 * one ticked lap gives its own time as the median and no spread (`iqr`). Every
 * Session median, best mark and IQR over the ticked laps is this
 * (src/features/session/selectionStats.ts).
 */
export function columnStats(timesS: readonly (number | null)[]): SegmentStats {
  const xs = sortedFinite(timesS);
  if (xs.length === 0) return {n: 0, bestS: null, medianS: null, spreadS: null};
  return {
    n: xs.length,
    bestS: xs[0],
    medianS: quantile(xs, 0.5),
    spreadS: iqr(xs),
  };
}
