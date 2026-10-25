import {basisOf} from '@/src/analysis/lapBasis';
// The session as a spread grid: rows are laps, columns are sections. Each
// column's median and best come from the basis laps (the ticked ones, or
// the comparable ones with none ticked: selectionStats.ts), so ticking or
// unticking a lap moves every median, and the desktop table under the lap list
// reads the same numbers. An unticked lap stays a row, dimmed, compared with
// the ticked median, so removing a lap shows where it sat. Pure: the hook
// gathers the inputs, components draw.

import {type SegmentTimes} from '@/src/analysis/segments';

import {segmentBasisStats} from './selectionStats';
import {MIN_COMPARISON_LAPS} from '@/src/analysis/setStats';

export type GridSort =
  | {kind: 'lap'}
  | {kind: 'column'; index: number; dir: 'asc' | 'desc'};

export type GridColumn = {
  head: string;
  /** Basis laps with a time in this section. */
  n: number;
  bestS: number | null;
  medianS: number | null;
};

export type GridCell = {
  timeS: number | null;
  /** Time minus the ticked median; null with no time or no median. */
  deltaS: number | null;
  /** delta over this column's basis spread, held to ±1 (the colour only: the spread the screen prints is spreadRows.ts's). 0 with no spread. */
  unit: number;
  /** The fastest basis time in this section. */
  best: boolean;
  /** No time because the window was left with wheels off: the cell says "off", not a dash. */
  off: boolean;
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
  /** Laps the column numbers are of. */
  basisCount: number;
  columns: GridColumn[];
  rows: GridRow[];
};

/** The grid for one session. `ticked` is the shared selection. */
export function sessionGrid(
  times: SegmentTimes,
  ticked: ReadonlySet<string>,
  sort: GridSort = {kind: 'lap'},
): SessionGrid {
  const basis = new Set(basisOf(times.laps, ticked).map(l => l.id));
  const stats = segmentBasisStats(times, basis);
  const columns: GridColumn[] = times.segments.map((seg, i) => ({
    head: seg.label,
    n: stats[i].n,
    bestS: stats[i].bestS,
    medianS: stats[i].medianS,
  }));

  const rows: GridRow[] = times.laps.map(lap => ({
    lapId: lap.id,
    label: lap.label ?? lap.id,
    stint: lap.stint,
    stop: lap.stop === true,
    ticked: ticked.has(lap.id),
    cells: times.segments.map((_, i) => {
      const timeS = lap.timesS[i] ?? null;
      const {n, medianS, spreadS, bestS} = stats[i];
      // A median of one lap is no comparison: no gap to it.
      const deltaS =
        timeS != null && medianS != null && n >= MIN_COMPARISON_LAPS
          ? timeS - medianS
          : null;
      return {
        off: timeS == null && lap.offs?.[i] === true,
        timeS,
        deltaS,
        unit:
          deltaS != null && spreadS != null && spreadS > 0
            ? Math.max(-1, Math.min(1, deltaS / spreadS))
            : 0,
        best:
          basis.has(lap.id) &&
          timeS != null &&
          bestS != null &&
          timeS === bestS,
      };
    }),
  }));

  return {basisCount: basis.size, columns, rows: sortRows(rows, sort)};
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
