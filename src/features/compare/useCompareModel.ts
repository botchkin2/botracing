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
  type CompareSelection,
} from './model';

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
): CompareResult {
  const session = useSession(sessionId);
  const laps = useSessionLaps(sessionId);
  const band = useSessionBand(sessionId);
  const map = useSessionMap(sessionId);
  const lengthM = map.data?.lengthM || band.data?.lengthM || 0;
  const grids = useLapTraces(selection.laps, {lengthM, stepM: GRID_STEP_M});
  const traces = useMemo(() => {
    const out = new Map<string, GridTrace>();
    selection.laps.forEach((id, i) => {
      const g = grids[i];
      if (g) out.set(id, g);
    });
    return out;
  }, [selection.laps, grids]);

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
  ]);
}
