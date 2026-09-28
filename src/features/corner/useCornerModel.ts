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
  buildCornerModel,
  cornerLapIds,
  type CornerModel,
  type CornerSelection,
  traceIdsFor,
} from './model';

const GRID_STEP_M = 5;

export type CornerResult =
  | {state: 'loading'}
  | {state: 'error'; message: string}
  | {state: 'missing'}
  | {state: 'ready'; model: CornerModel; lapIds: string[]};

export function useCornerModel(
  sessionId: string,
  corner: number,
  selection: CornerSelection,
  allComparable: boolean,
): CornerResult {
  const session = useSession(sessionId);
  const laps = useSessionLaps(sessionId);
  const band = useSessionBand(sessionId);
  const map = useSessionMap(sessionId);

  const lapIds = useMemo(
    () =>
      laps.data
        ? cornerLapIds(
            laps.data,
            selection,
            allComparable,
            session.data?.bestLapId ?? null,
          )
        : [],
    [laps.data, selection, allComparable, session.data?.bestLapId],
  );
  // With many laps only the key laps' traces load; the rest show as dots.
  const traceIds = useMemo(
    () => traceIdsFor(lapIds, selection.hl),
    [lapIds, selection.hl],
  );
  const lengthM = map.data?.lengthM || band.data?.lengthM || 0;
  const grids = useLapTraces(traceIds, {lengthM, stepM: GRID_STEP_M});
  const traces = useMemo(() => {
    const out = new Map<string, GridTrace>();
    traceIds.forEach((id, i) => {
      const g = grids[i];
      if (g) out.set(id, g);
    });
    return out;
  }, [traceIds, grids]);

  const error = [session, laps, map].find(q => q.isError)?.error;
  return useMemo((): CornerResult => {
    if (error)
      return {
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      };
    if (!session.data || !laps.data || !map.data) return {state: 'loading'};
    const model = buildCornerModel({
      session: session.data,
      laps: laps.data,
      map: map.data,
      band: band.data ?? null,
      traces,
      lapIds,
      hl: selection.hl,
      corner,
    });
    return model ? {state: 'ready', model, lapIds} : {state: 'missing'};
  }, [
    error,
    session.data,
    laps.data,
    map.data,
    band.data,
    traces,
    lapIds,
    selection.hl,
    corner,
  ]);
}
