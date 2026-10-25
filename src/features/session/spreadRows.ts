import {
  type PooledSession,
  sectionVary,
  type VaryLap,
} from '@/src/analysis/sectionVary';
import {type SegmentTimes} from '@/src/analysis/segments';
import {dayMonthOf} from '@/src/design';

import type {SectionTable} from './model';

/** Rows shown: the first few of the ranking. */
export const SPREAD_ROWS = 4;

/** One section of the "Varies most" block (analysis/sectionVary.ts). */
export type SpreadRow = {
  head: string;
  /** "wheels off 5 of 12 laps" for a section named for its offs; null otherwise. */
  offs: string | null;
  /** "0.36 s", the IQR; null where the section has too few laps for one. */
  seconds: string | null;
  /** The bar: this spread over the biggest one shown, 0..1. */
  frac: number;
  /** Where a tap opens Corner (the section's first corner); null for the start straight. */
  corner: number | null;
  whole: boolean;
};

export type SpreadBlock = {
  rows: SpreadRow[];
  /** "12 laps, this session", "14 laps: this session and Oct 19", or what is missing; null with no sections. */
  line: string | null;
};

export const NO_SPREAD: SpreadBlock = {rows: [], line: null};

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The sections he varies most in, in seconds, with the wheels-off laps said and never silently dropped
 * (analysis/sectionVary.ts): this session's basis laps, and when it has too few in a section, the earlier sessions
 * `pool` hands in. Pure: the Session screen draws these and the Corner tab lands on the first row.
 */
export function spreadRows(
  times: SegmentTimes | null,
  basis: ReadonlySet<string>,
  table: SectionTable | null,
  pool: readonly PooledSession[] = [],
): SpreadBlock {
  if (!times) return NO_SPREAD;
  const own: VaryLap[] = times.laps
    .filter(l => basis.has(l.id))
    .map(l => ({timesS: l.timesS, offs: l.offs}));
  const vary = sectionVary(own, pool, times.segments.length);
  if (!vary) {
    return {
      rows: [],
      line:
        own.length === 0
          ? null
          : `${plural(
              own.length,
              'lap',
              'laps',
            )}: too few to say where it varies`,
    };
  }
  const widest = Math.max(0, ...vary.rows.map(r => r.spreadS ?? 0));
  const rows = vary.rows.slice(0, SPREAD_ROWS).map(r => ({
    head: times.segments[r.index].label,
    offs: r.offsFirst
      ? `wheels off ${r.offLaps} of ${plural(r.ownLaps, 'lap', 'laps')}`
      : null,
    seconds: r.spreadS != null ? `${r.spreadS.toFixed(2)} s` : null,
    frac: r.spreadS != null && widest > 0 ? r.spreadS / widest : 0,
    corner: table?.targets[r.index]?.corner ?? null,
    whole: table?.targets[r.index]?.whole ?? false,
  }));
  const line =
    vary.pooledFrom.length > 0
      ? `${plural(
          vary.ownLaps + vary.pooledLaps,
          'lap',
          'laps',
        )}: this session and ${vary.pooledFrom
          .map(at => dayMonthOf(new Date(at)))
          .join(', ')}`
      : `${plural(vary.ownLaps, 'lap', 'laps')}, this session`;
  return {rows, line};
}
