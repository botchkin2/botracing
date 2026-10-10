import {useMemo, useState} from 'react';

import {sessionGrid, type GridSort, type SessionGrid} from './grid';
import {useSessionSegmentTimes} from './model';

export type SessionGridState = {
  grid: SessionGrid;
  sort: GridSort;
  setSort: (sort: GridSort) => void;
};

/**
 * The session grid's inputs: the section times, the ticked laps (the screen's
 * one resolved selection, passed in), and the grid's own sort. Null until the
 * laps load or when the session has no section times.
 */
export function useSessionGrid(
  id: string,
  ticked: readonly string[],
): SessionGridState | null {
  const times = useSessionSegmentTimes(id);
  const [sort, setSort] = useState<GridSort>({kind: 'lap'});
  const set = useMemo(() => new Set(ticked), [ticked]);
  const grid = useMemo(
    () => (times ? sessionGrid(times, set, sort) : null),
    [times, set, sort],
  );
  if (!grid) return null;
  return {grid, sort, setSort};
}
