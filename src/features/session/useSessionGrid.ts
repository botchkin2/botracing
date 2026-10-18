import {useMemo, useState} from 'react';

import {sessionGrid, type GridSort, type SessionGrid} from './grid';
import type {DaySet} from '@/src/data/sessions';

import {useDaySegmentTimes, useSessionSegmentTimes} from './model';

export type SessionGridState = {
  grid: SessionGrid;
  sort: GridSort;
  setSort: (sort: GridSort) => void;
};

/**
 * The session grid's inputs: the section times, the ticked laps (the screen's
 * one resolved selection, passed in), and the grid's own sort. Null until the
 * laps load or when the session has no section times. A day reads its merged
 * laps (data/sessions/lapSet.ts).
 */
export function useSessionGrid(
  id: string,
  ticked: readonly string[],
  day: DaySet | null = null,
): SessionGridState | null {
  const own = useSessionSegmentTimes(id);
  const dayTimes = useDaySegmentTimes(day);
  const times = day ? dayTimes : own;
  const [sort, setSort] = useState<GridSort>({kind: 'lap'});
  const set = useMemo(() => new Set(ticked), [ticked]);
  const grid = useMemo(
    () => (times ? sessionGrid(times, set, sort) : null),
    [times, set, sort],
  );
  if (!grid) return null;
  return {grid, sort, setSort};
}
