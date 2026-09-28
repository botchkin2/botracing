import {useMemo} from 'react';

import {type GridTrace} from '@/src/analysis/resample';
import {
  useSession,
  useSessionBand,
  useSessionLaps,
  useSessionMap,
} from '@/src/data/sessions';
import {useLapTraces} from '@/src/data/traces';

import {
  buildCompareModel,
  type ChannelId,
  type CompareModel,
  type ChartWindow,
  type CompareSelection,
} from './model';

import {buildFollowGeometry} from './followModel';
import {mapPlacer} from './mapPlace';

// Same 5 m grid as the stored band, so band and laps line up point for point.
const GRID_STEP_M = 5;

export type CompareResult =
  | {state: 'loading'}
  | {state: 'error'; message: string}
  | {state: 'ready'; model: CompareModel};

export function useCompareModel(
  sessionId: string,
  selection: CompareSelection,
  charts?: ChannelId[][],
  window?: ChartWindow,
): CompareResult {
  const session = useSession(sessionId);
  const laps = useSessionLaps(sessionId);
  const band = useSessionBand(sessionId);
  const map = useSessionMap(sessionId);
  const lengthM = map.data?.lengthM || band.data?.lengthM || 0;
  // Fetch traces only for ids this session has; a hand-edited URL with
  // unknown ids would otherwise fire a 404 per id.
  const knownIds = useMemo(() => {
    const ids = new Set(laps.data?.map(l => l.id));
    return selection.laps.filter(id => ids.has(id));
  }, [laps.data, selection.laps]);
  const grids = useLapTraces(knownIds, {lengthM, stepM: GRID_STEP_M});
  const traces = useMemo(() => {
    const out = new Map<string, GridTrace>();
    knownIds.forEach((id, i) => {
      const g = grids[i];
      if (g) out.set(id, g);
    });
    return out;
  }, [knownIds, grids]);

  // Follow's lines, band and inset only change with the selection, so build
  // them here once rather than on every cursor move (CODE_STANDARDS §6).
  const followGeometry = useMemo(
    () => buildFollowGeometry(mapPlacer(map.data ?? null), traces, knownIds),
    [map.data, traces, knownIds],
  );

  const error = [session, laps].find(q => q.isError)?.error;
  return useMemo(() => {
    if (error)
      return {
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    if (!session.data || !laps.data || map.isPending) return {state: 'loading'};
    return {
      state: 'ready',
      model: buildCompareModel({
        session: session.data,
        laps: laps.data,
        traces,
        band: band.data ?? null,
        map: map.data ?? null,
        selection,
        charts,
        window,
        followGeometry,
      }),
    };
  }, [
    error,
    session.data,
    laps.data,
    map.isPending,
    map.data,
    band.data,
    traces,
    selection,
    charts,
    window,
    followGeometry,
  ]);
}
