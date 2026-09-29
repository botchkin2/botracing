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
} from './model';
import {keyLapIds as keyLapsOf} from './keyLaps';

const GRID_STEP_M = 5;

export type CornerResult =
  | {state: 'loading'}
  | {state: 'error'; message: string}
  /** noMap: the track has no corner map yet; else this corner doesn't exist. */
  | {state: 'missing'; noMap: boolean}
  /** The session has no comparable lap to show. */
  | {state: 'noLaps'}
  | {
      state: 'ready';
      model: CornerModel;
      lapIds: string[];
      /** Laps on, reference first: what a strip tap toggles. */
      keyLapIds: string[];
    };

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
  // Only the laps on load traces; the rest show as dots.
  const bestLapId = session.data?.bestLapId ?? null;
  const traceIds = useMemo(
    () =>
      keyLapsOf({
        lapIds,
        selected: selection.laps,
        hl: selection.hl,
        bestLapId,
        individual: lapIds.length < 7,
      }),
    [lapIds, selection.laps, selection.hl, bestLapId],
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
    if (lapIds.length === 0) return {state: 'noLaps'};
    const model = buildCornerModel({
      session: session.data,
      laps: laps.data,
      map: map.data,
      band: band.data ?? null,
      traces,
      lapIds,
      keyLapIds: traceIds,
      hl: selection.hl,
      corner,
    });
    return model
      ? {state: 'ready', model, lapIds, keyLapIds: traceIds}
      : {state: 'missing', noMap: map.data.sections.length === 0};
  }, [
    error,
    session.data,
    laps.data,
    map.data,
    band.data,
    traces,
    lapIds,
    traceIds,
    selection.hl,
    corner,
  ]);
}
