import {useMemo, useState} from 'react';

import {sessionGrid, type GridSort, type SessionGrid} from './grid';
import {useSessionSegmentTimes} from './model';
import {useLapSelection} from './useLapSelection';

export type SessionGridState = {
  grid: SessionGrid;
  sort: GridSort;
  setSort: (sort: GridSort) => void;
  /** Tick or untick a lap; every median and spread recomputes. */
  tap: (lapId: string) => void;
};

/**
 * The session grid's inputs: the section times, the shared lap selection
 * (ticked laps), and the screen's own sort. Null until the laps load or when
 * the session has no section times.
 */
export function useSessionGrid(id: string): SessionGridState | null {
  const times = useSessionSegmentTimes(id);
  const sel = useLapSelection();
  const [sort, setSort] = useState<GridSort>({kind: 'lap'});
  const ticked = useMemo(() => new Set(sel.laps), [sel.laps]);
  const grid = useMemo(
    () => (times ? sessionGrid(times, ticked, sort) : null),
    [times, ticked, sort],
  );
  if (!grid) return null;
  return {grid, sort, setSort, tap: sel.tap};
}
