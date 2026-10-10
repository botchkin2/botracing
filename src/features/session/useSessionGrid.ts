import {useMemo, useState} from 'react';

import {sessionGrid, type GridSort, type SessionGrid, tapLaps} from './grid';
import {useSessionOpeningLapIds, useSessionSegmentTimes} from './model';
import {useLapSelection} from './useLapSelection';

export type SessionGridState = {
  grid: SessionGrid;
  sort: GridSort;
  setSort: (sort: GridSort) => void;
  /** Tick or untick a lap; every median and spread recomputes. */
  tap: (lapId: string) => void;
};

/**
 * The session grid's inputs: the section times, the ticked laps (the URL's,
 * or the opening set when the URL names none, as Compare does), and the
 * screen's own sort. Null until the laps load or when the session has no
 * section times.
 */
export function useSessionGrid(id: string): SessionGridState | null {
  const times = useSessionSegmentTimes(id);
  const defaults = useSessionOpeningLapIds(id);
  const sel = useLapSelection();
  const [sort, setSort] = useState<GridSort>({kind: 'lap'});
  const ticks = useMemo(
    () => (sel.laps.length > 0 ? sel.laps : defaults),
    [sel.laps, defaults],
  );
  const ticked = useMemo(() => new Set(ticks), [ticks]);
  const grid = useMemo(
    () => (times ? sessionGrid(times, ticked, sort) : null),
    [times, ticked, sort],
  );
  if (!grid) return null;
  const tap = (lapId: string) =>
    sel.update({laps: tapLaps(sel.laps, defaults, lapId)});
  return {grid, sort, setSort, tap};
}
