import {useMemo} from 'react';

import {type GridTrace} from '@/src/analysis/resample';
import {
  type Lap,
  useSession,
  useSessionBand,
  useSessionLaps,
  useSessionMap,
  useSessionSurface,
  useSessionsDetail,
  useSessionsLaps,
  mapPlacer,
  trackCorners,
} from '@/src/data/sessions';
import {parseLapRef} from '@/src/nav/lapRef';
import {type TraceLoad, useLapTraceLoad} from '@/src/data/traces';

import {
  buildCompareModel,
  type ForeignLaps,
  type ChannelId,
  type CompareModel,
  type ChartWindow,
  type CompareSelection,
} from './model';

import {buildFollowGeometry} from './followModel';
import {foreignTag} from './foreignTag';

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
  const surface = useSessionSurface(sessionId);
  const lengthM = map.data?.lengthM || band.data?.lengthM || 0;
  // Laps of other sessions in the selection (`sessionId~lapId`): their
  // sessions' laps and docs are read so each can be found and tagged.
  const foreignSessionIds = useMemo(
    () => [
      ...new Set(selection.laps.flatMap(id => parseLapRef(id).sessionId ?? [])),
    ],
    [selection.laps],
  );
  const foreignLaps = useSessionsLaps(foreignSessionIds);
  const foreignDetails = useSessionsDetail(foreignSessionIds);
  const foreign = useMemo<ForeignLaps>(() => {
    const out: Lap[] = [];
    const tags = new Map<string, string>();
    // A session with a corner map of its own has sections that do not line
    // up with this one's, so its laps are not offered beside it.
    const sectionsAgree = session.data?.cornerMapSource !== 'session';
    for (const id of selection.laps) {
      const ref = parseLapRef(id);
      const at = foreignSessionIds.indexOf(ref.sessionId ?? '');
      const detail = foreignDetails.details[at];
      const lap = foreignLaps.laps[at]?.find(l => l.id === ref.lapId);
      if (!lap || !detail || !sectionsAgree) continue;
      if (detail.cornerMapSource === 'session') continue;
      out.push({...lap, id});
      tags.set(id, foreignTag(detail.startedAt, detail.sessionType));
    }
    return {
      laps: out,
      tags,
      ownTag: session.data
        ? foreignTag(session.data.startedAt, session.data.sessionType)
        : undefined,
    };
  }, [
    selection.laps,
    foreignSessionIds,
    foreignLaps.laps,
    foreignDetails.details,
    session.data?.cornerMapSource,
    session.data?.startedAt,
    session.data?.sessionType,
  ]);
  // Fetch traces only for ids this session has, or that came from another
  // session; a hand-edited URL with unknown ids would otherwise fire a 404
  // per id.
  const knownIds = useMemo(() => {
    const ids = new Set([
      ...(laps.data ?? []).map(l => l.id),
      ...foreign.laps.map(l => l.id),
    ]);
    return selection.laps.filter(id => ids.has(id));
  }, [laps.data, foreign.laps, selection.laps]);
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
  // Traces are fetched by the lap's own id; the model knows the selection id.
  const traceIds = useMemo(
    () => fetchIds.map(id => parseLapRef(id).lapId),
    [fetchIds],
  );
  const {
    traces: grids,
    load: traceLoad,
    retry: retryTraces,
  } = useLapTraceLoad(traceIds, {lengthM, stepM: GRID_STEP_M}, knownIds.length);
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
        mapPlacer(map.data ?? null, surface.data ?? null),
        traces,
        knownIds,
        map.data ? trackCorners(map.data) : [],
      ),
    [map.data, surface.data, traces, knownIds],
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
    // A lap of another session is found once its session has loaded; until
    // then it would read as "not found".
    const waitingOnForeign =
      foreignSessionIds.length > 0 &&
      (foreignLaps.pending || foreignDetails.pending);
    if (!session.data || !laps.data || map.isPending || waitingOnForeign)
      return {state: 'loading'};
    return {
      state: 'ready',
      traceLoad,
      retryTraces,
      model: buildCompareModel({
        session: session.data,
        laps: laps.data,
        foreign,
        traces,
        band: band.data ?? null,
        map: map.data ?? null,
        surface: surface.data ?? null,
        surfacePending: surface.isPending,
        selection,
        charts,
        window,
        followGeometry,
      }),
    };
  }, [
    error,
    foreignSessionIds,
    foreignLaps.pending,
    foreignDetails.pending,
    session.data,
    laps.data,
    foreign,
    map.isPending,
    map.data,
    surface.data,
    surface.isPending,
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
