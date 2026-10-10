// The session as a spread grid: rows are laps, columns are sections. Each
// column's median and spread come from the ticked laps only (the selection the
// other screens share), so ticking or unticking a lap moves every median. An
// unticked lap stays a row, dimmed, compared with the ticked median, so removing
// a lap shows where it sat. Pure: the hook gathers the inputs, components draw.

import {columnStats, type SegmentTimes} from '@/src/analysis/segments';
import {toggle} from '@/src/state/lapSelection';

export type GridSort =
  | {kind: 'lap'}
  | {kind: 'column'; index: number; dir: 'asc' | 'desc'};

export type GridColumn = {
  head: string;
  /** Ticked laps with a time in this section. */
  n: number;
  bestS: number | null;
  medianS: number | null;
  spreadS: number | null;
  /** The spread bar's length: this column's spread over the widest one, 0–1. */
  barFraction: number;
};

export type GridCell = {
  timeS: number | null;
  /** Time minus the ticked median; null with no time or no median. */
  deltaS: number | null;
  /** delta over this column's spread, held to ±1 (the colour). 0 with no spread. */
  unit: number;
  /** The fastest ticked time in this section. */
  best: boolean;
};

export type GridRow = {
  lapId: string;
  /** "L5", as the tables name it. */
  label: string;
  stint: number;
  /** A pit stop was entered on this lap. */
  stop: boolean;
  ticked: boolean;
  cells: GridCell[];
};

export type SessionGrid = {
  columns: GridColumn[];
  rows: GridRow[];
};

/**
 * The grid for one session. `ticked` is the shared selection; with none ticked
 * every column is empty and the rows show their own times only.
 */
export function sessionGrid(
  times: SegmentTimes,
  ticked: ReadonlySet<string>,
  sort: GridSort = {kind: 'lap'},
): SessionGrid {
  const stats = times.segments.map((_, i) =>
    columnStats(
      times.laps.filter(l => ticked.has(l.id)).map(l => l.timesS[i] ?? null),
    ),
  );
  const widest = Math.max(0, ...stats.map(s => s.spreadS ?? 0));
  const columns: GridColumn[] = times.segments.map((seg, i) => ({
    head: seg.label,
    n: stats[i].n,
    bestS: stats[i].bestS,
    medianS: stats[i].medianS,
    spreadS: stats[i].spreadS,
    barFraction: widest > 0 ? (stats[i].spreadS ?? 0) / widest : 0,
  }));

  const rows: GridRow[] = times.laps.map(lap => ({
    lapId: lap.id,
    label: lap.label ?? lap.id,
    stint: lap.stint,
    stop: lap.stop === true,
    ticked: ticked.has(lap.id),
    cells: times.segments.map((_, i) => {
      const timeS = lap.timesS[i] ?? null;
      const {medianS, spreadS, bestS} = stats[i];
      const deltaS = timeS != null && medianS != null ? timeS - medianS : null;
      return {
        timeS,
        deltaS,
        unit:
          deltaS != null && spreadS != null && spreadS > 0
            ? Math.max(-1, Math.min(1, deltaS / spreadS))
            : 0,
        best: timeS != null && bestS != null && timeS === bestS,
      };
    }),
  }));

  return {columns, rows: sortRows(rows, sort)};
}

/** Stable sort: by lap order, or by one column's time (lap with no time last). */
export function sortRows(rows: readonly GridRow[], sort: GridSort): GridRow[] {
  if (sort.kind === 'lap') return [...rows];
  const sign = sort.dir === 'asc' ? 1 : -1;
  const key = (r: GridRow) => r.cells[sort.index]?.timeS ?? null;
  return rows
    .map((r, i) => ({r, i}))
    .sort((a, b) => {
      const ka = key(a.r);
      const kb = key(b.r);
      if (ka == null && kb == null) return a.i - b.i;
      if (ka == null) return 1;
      if (kb == null) return -1;
      return sign * (ka - kb) || a.i - b.i;
    })
    .map(x => x.r);
}

/**
 * The ticked set after one tap. With nothing in the URL the grid shows the
 * opening set (`defaults`), so the first tap starts from it: one lap comes
 * off, the rest stay ticked.
 */
export function tapLaps(
  urlLaps: readonly string[],
  defaults: readonly string[],
  lapId: string,
): string[] {
  return toggle(urlLaps.length > 0 ? urlLaps : defaults, lapId);
}
