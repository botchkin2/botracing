import {
  type PooledSession,
  type SectionVary,
  sectionVary,
  type VaryLap,
} from '@/src/analysis/sectionVary';
import {type SegmentTimes} from '@/src/analysis/segments';
import {dayMonthOf} from '@/src/design';

import type {SectionTable} from './model';

/** Rows shown: the first few of the ranking. */
export const SPREAD_ROWS = 4;

/**
 * One section's answer to "how much does it vary" (analysis/sectionVary.ts), in the words the screen prints. The
 * Varies most rows, the grid's Varies row and the table footer all read these, so a section has one number everywhere.
 */
export type SpreadCell = {
  /** "wheels off 5 of 12 laps" for a section named for its offs; null otherwise. */
  offs: string | null;
  /** The same for a narrow column: "off 5/12". */
  offsShort: string | null;
  /** "0.36 s", the IQR; null where the section has too few laps for one, and for a section named for its offs (no seconds beside it). */
  seconds: string | null;
  /** The bar: this spread over the biggest one, 0..1. */
  frac: number;
  /** The seconds rest on laps pooled with earlier sessions (the block's line names them). */
  pooled: boolean;
};

/** One section of the "Varies most" block. */
export type SpreadRow = SpreadCell & {
  head: string;
  /** Where a tap opens Corner (the section's first corner); null for the start straight. */
  corner: number | null;
  whole: boolean;
};

export type SpreadBlock = {
  rows: SpreadRow[];
  /** One entry per section column, in the order of the columns; null where the section has no spread to say. */
  columns: (SpreadCell | null)[];
  /** "12 laps, this session", "14 laps: this session and Oct 19", or what is missing; null with no sections. */
  line: string | null;
};

export const NO_SPREAD: SpreadBlock = {rows: [], columns: [], line: null};

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The sections of the basis laps ranked by how much they vary, with the earlier sessions `pool` hands in where a
 * section has too few laps (data/sessions/spreadPool.ts); null when no section can say. The one place the screen asks.
 */
export function varyOf(
  times: SegmentTimes | null,
  basis: ReadonlySet<string>,
  pool: readonly PooledSession[] = [],
): SectionVary | null {
  if (!times) return null;
  const own: VaryLap[] = times.laps
    .filter(l => basis.has(l.id))
    .map(l => ({timesS: l.timesS, offs: l.offs}));
  return sectionVary(own, pool, times.segments.length);
}

/** What each section column says about its spread; null where the section has none to say. */
export function spreadColumns(
  times: SegmentTimes,
  vary: SectionVary | null,
): (SpreadCell | null)[] {
  const columns: (SpreadCell | null)[] = times.segments.map(() => null);
  if (!vary) return columns;
  // A section named for its offs has no bar, so it does not set the scale of the others.
  const widest = Math.max(
    0,
    ...vary.rows.map(r => (r.offsFirst ? 0 : r.spreadS ?? 0)),
  );
  for (const r of vary.rows) {
    const seconds = r.spreadS != null && !r.offsFirst ? r.spreadS : null;
    columns[r.index] = {
      offs: r.offsFirst
        ? `wheels off ${r.offLaps} of ${plural(r.ownLaps, 'lap', 'laps')}`
        : null,
      offsShort: r.offsFirst ? `off ${r.offLaps}/${r.ownLaps}` : null,
      seconds: seconds != null ? `${seconds.toFixed(2)} s` : null,
      frac: seconds != null && widest > 0 ? seconds / widest : 0,
      pooled: r.pooled,
    };
  }
  return columns;
}

/**
 * The sections he varies most in, in seconds, with the wheels-off laps said and never silently dropped
 * (analysis/sectionVary.ts). Pure: the Session screen draws these and the Corner tab lands on the first row.
 */
export function spreadRows(
  times: SegmentTimes | null,
  basis: ReadonlySet<string>,
  table: SectionTable | null,
  vary: SectionVary | null,
): SpreadBlock {
  if (!times) return NO_SPREAD;
  const columns = spreadColumns(times, vary);
  if (!vary) {
    const own = times.laps.filter(l => basis.has(l.id)).length;
    return {
      rows: [],
      columns,
      line:
        own === 0
          ? null
          : `${plural(own, 'lap', 'laps')}: too few to say where it varies`,
    };
  }
  const rows: SpreadRow[] = [];
  for (const r of vary.rows.slice(0, SPREAD_ROWS)) {
    const cell = columns[r.index];
    if (!cell) continue;
    rows.push({
      ...cell,
      head: times.segments[r.index].label,
      corner: table?.targets[r.index]?.corner ?? null,
      whole: table?.targets[r.index]?.whole ?? false,
    });
  }
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
  return {rows, columns, line};
}
