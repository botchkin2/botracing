import {useMemo} from 'react';

import {type GridTrace} from '@/src/analysis/resample';
import {
  useSession,
  useSessionBand,
  useSessionLaps,
  useSessionMap,
  mapPlacer,
  trackCorners,
} from '@/src/data/sessions';
import {type TraceLoad, useLapTraceLoad} from '@/src/data/traces';

import {
  buildCompareModel,
  type ChannelId,
  type CompareModel,
  type ChartWindow,
  type CompareSelection,
} from './model';

import {buildFollowGeometry} from './followModel';

import {lapNeighbours, WRAP_M} from './neighbours';

// Same 5 m grid as the stored band, so band and laps line up point for point.
const GRID_STEP_M = 5;

export type CompareResult =
  | {state: 'loading'}
  | {state: 'error'; message: string; retry: () => void}
  | {
      state: 'ready';
      model: CompareModel;
      /** The selected laps' traces, for skeletons and the retry banner. */
      traceLoad: TraceLoad;
      retryTraces: () => void;
    };

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
  // The S/F wrap needs each lap's contiguous neighbours, but only while the
  // window is near the line (thread 27 #377). Compare opens at 0 m, so that
  // is usually at once; each trace is cached by lap id either way.
  const nearLine =
    window?.size != null &&
    lengthM > 0 &&
    (selection.cursorM < WRAP_M || selection.cursorM > lengthM - WRAP_M);
  const fetchIds = useMemo(() => {
    if (!nearLine || !laps.data) return knownIds;
    const extra = knownIds.flatMap(id => {
      const n = lapNeighbours(laps.data!, id);
      return [n.before, n.after].flatMap(s =>
        s.kind === 'lap' ? [s.lapId] : [],
      );
    });
    return [...new Set([...knownIds, ...extra])];
  }, [nearLine, laps.data, knownIds]);
  const {
    traces: grids,
    load: traceLoad,
    retry: retryTraces,
  } = useLapTraceLoad(
    fetchIds,
    {lengthM, stepM: GRID_STEP_M},
    knownIds.length,
  );
  const traces = useMemo(() => {
    const out = new Map<string, GridTrace>();
    fetchIds.forEach((id, i) => {
      const g = grids[i];
      if (g) out.set(id, g);
    });
    return out;
  }, [fetchIds, grids]);

  // Follow's lines, band and inset only change with the selection, so build
  // them here once rather than on every cursor move (CODE_STANDARDS §6).
  const followGeometry = useMemo(
    () =>
      buildFollowGeometry(
        mapPlacer(map.data ?? null),
        traces,
        knownIds,
        map.data ? trackCorners(map.data) : [],
      ),
    [map.data, traces, knownIds],
  );

  // Stable functions, so they can sit in the memo's dependencies.
  const {refetch: refetchSession} = session;
  const {refetch: refetchLaps} = laps;
  const error = [session, laps].find(q => q.isError)?.error;
  return useMemo(() => {
    if (error)
      return {
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
        retry: () => {
          void refetchSession();
          void refetchLaps();
        },
      };
    if (!session.data || !laps.data || map.isPending) return {state: 'loading'};
    return {
      state: 'ready',
      traceLoad,
      retryTraces,
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
    traceLoad,
    retryTraces,
    refetchSession,
    refetchLaps,
  ]);
}
