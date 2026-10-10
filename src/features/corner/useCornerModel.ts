import {useCallback, useMemo} from 'react';

import {type GridTrace} from '@/src/analysis/resample';
import {
  defaultSessionOf,
  useSession,
  useSessionBand,
  useSessionLaps,
  useTrackMap,
  trackCorners,
} from '@/src/data/sessions';
import {
  sliceLoad,
  sliceReachesApex,
  sliceToGridTrace,
  type TraceLoad,
  useCornerSlices,
} from '@/src/data/traces';

import {
  buildCornerModel,
  cornerLapIds,
  type CornerModel,
  type CornerSelection,
} from './model';
import {keyLapIds as keyLapsOf} from './keyLaps';
import {sliceCornerOf} from './wholeCorner';

export type CornerResult =
  | {state: 'loading'}
  | {state: 'error'; message: string; retry: () => void}
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
      traceLoad: TraceLoad;
      retryTraces: () => void;
    };

export function useCornerModel(
  sessionId: string,
  corner: number,
  urlSelection: CornerSelection,
  allComparable: boolean,
  whole = false,
): CornerResult {
  const session = useSession(sessionId);
  const laps = useSessionLaps(sessionId);
  const selection = urlSelection;
  const band = useSessionBand(sessionId);
  const map = useTrackMap(session.data?.trackId);

  const lapIds = useMemo(
    () =>
      laps.data
        ? cornerLapIds(
            laps.data,
            selection,
            allComparable,
            session.data ? defaultSessionOf(session.data) : null,
          )
        : [],
    [laps.data, selection, allComparable, session.data],
  );
  // The laps on: drawn in their own colour and named on the strips.
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
  // Every lap comes from the corner's slice file (one small fetch), so every
  // comparable lap draws, not only the laps on. A session the uploader has
  // not resynced since analysis version 13 has no file: nothing to draw yet.
  const slicePointer = session.data?.slices ?? null;
  // "All" on a compound corner draws from its last part's file, which spans
  // the whole section (wholeCorner.ts).
  const sliceCorner = useMemo(
    () =>
      map.data ? sliceCornerOf(trackCorners(map.data), corner, whole) : corner,
    [map.data, corner, whole],
  );
  const hasFile = slicePointer?.corners.includes(sliceCorner) ?? false;
  const slices = useCornerSlices(
    sessionId,
    sliceCorner,
    hasFile ? slicePointer?.hash ?? null : null,
  );
  const {refetch: refetchSlices} = slices;
  const traces = useMemo(() => {
    const out = new Map<string, GridTrace>();
    if (!slices.data) return out;
    for (const lap of slices.data.laps)
      if (sliceReachesApex(lap, slices.data))
        out.set(lap.id, sliceToGridTrace(lap, slices.data));
    return out;
  }, [slices.data]);
  const traceLoad = useMemo(
    (): TraceLoad =>
      sliceLoad({
        lapCount: lapIds.length,
        sessionKnown: session.data != null,
        hasFile,
        status: slices.status,
      }),
    [lapIds.length, session.data, hasFile, slices.status],
  );
  const retryTraces = useCallback(() => {
    void refetchSlices();
  }, [refetchSlices]);

  // Stable functions, so they can sit in the memo's dependencies.
  const {refetch: refetchSession} = session;
  const {refetch: refetchLaps} = laps;
  const {refetch: refetchMap} = map;
  const error = [session, laps, map].find(q => q.isError)?.error;
  return useMemo((): CornerResult => {
    if (error)
      return {
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
        retry: () => {
          void refetchSession();
          void refetchLaps();
          void refetchMap();
        },
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
      refId: selection.ref ?? null,
      corner,
      whole,
    });
    return model
      ? {
          state: 'ready',
          model,
          lapIds,
          keyLapIds: traceIds,
          traceLoad,
          retryTraces,
        }
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
    whole,
    traceLoad,
    retryTraces,
    refetchSession,
    refetchLaps,
    refetchMap,
  ]);
}
