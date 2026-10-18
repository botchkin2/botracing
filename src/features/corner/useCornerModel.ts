import {useCallback, useMemo} from 'react';

import {type GridTrace} from '@/src/analysis/resample';
import {
  dayBestLapId,
  dayLapId,
  defaultSessionOf,
  openingLapIds,
  useDaySet,
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
  useDayCornerSlices,
} from '@/src/data/traces';

import {
  buildCornerModel,
  cornerLapIds,
  type CornerModel,
  type CornerSelection,
} from './model';
import {lapMode} from '@/src/design';
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
      /** Laps on: what a strip tap toggles (their order carries no meaning). */
      keyLapIds: string[];
      /** The session's best lap, else the fastest drawn: what Reset keeps. */
      openingIds: string[];
      traceLoad: TraceLoad;
      retryTraces: () => void;
    };

export function useCornerModel(
  sessionId: string,
  corner: number,
  urlSelection: CornerSelection,
  allComparable: boolean,
  whole = false,
  setKind: 'session' | 'day' = 'session',
): CornerResult {
  const route = useSession(sessionId);
  const routeLaps = useSessionLaps(sessionId);
  const selection = urlSelection;
  const band = useSessionBand(sessionId);
  const map = useTrackMap(route.data?.trackId);
  // A day (data/sessions/lapSet.ts): its first member names the track and car,
  // its merged laps are the laps, and each member's slice file draws its own.
  const dayState = useDaySet(sessionId, route.data?.trackId, setKind === 'day');
  const day = dayState.state === 'ready' ? dayState.set : null;
  const session = day ? {...route, data: day.members[0]} : route;
  const laps = day ? {...routeLaps, data: day.laps} : routeLaps;

  const lapIds = useMemo(
    () =>
      laps.data
        ? day && selection.laps.length === 0 && !allComparable
          ? day.openingIds
          : cornerLapIds(
              laps.data,
              selection,
              allComparable,
              session.data ? defaultSessionOf(session.data) : null,
            )
        : [],
    [laps.data, selection, allComparable, session.data, day],
  );
  // What Reset goes back to: the opening set, as Session and Compare open.
  const openingIds = useMemo(
    () =>
      day
        ? day.openingIds
        : laps.data && session.data
        ? openingLapIds(laps.data, defaultSessionOf(session.data))
        : [],
    [laps.data, session.data, day],
  );
  // The laps on: drawn in their own colour and named on the strips.
  const bestLapId = day
    ? dayBestLapId(day.laps)
    : session.data?.bestLapId ?? null;
  // The drawn laps, fastest first: "the best" and "the next" come from here.
  const ranked = useMemo(
    () =>
      (laps.data ?? [])
        .filter(l => lapIds.includes(l.id) && l.timeS != null)
        .sort((a, b) => (a.timeS as number) - (b.timeS as number))
        .map(l => l.id),
    [laps.data, lapIds],
  );
  const traceIds = useMemo(
    () =>
      keyLapsOf({
        lapIds,
        selected: selection.laps,
        hl: selection.hl,
        bestLapId,
        ranked,
        individual: lapMode(lapIds.length) === 'individual',
      }),
    [lapIds, selection.laps, selection.hl, bestLapId, ranked],
  );
  // Every lap comes from the corner's slice file (one small fetch), so every
  // comparable lap draws, not only the laps on. A session the uploader has
  // not resynced since analysis version 13 has no file: nothing to draw yet.
  const slicePointer = day ? null : session.data?.slices ?? null;
  // "All" on a compound corner draws from its last part's file, which spans
  // the whole section (wholeCorner.ts).
  const sliceCorner = useMemo(
    () =>
      map.data ? sliceCornerOf(trackCorners(map.data), corner, whole) : corner,
    [map.data, corner, whole],
  );
  // A day reads one file per member that has it for this corner.
  const dayFiles = (day?.members ?? []).map(m => ({
    id: m.id,
    hash: m.slices?.corners.includes(sliceCorner) ? m.slices.hash : null,
  }));
  const daySlices = useDayCornerSlices(dayFiles, sliceCorner);
  const hasFile = day
    ? dayFiles.some(f => f.hash != null)
    : slicePointer?.corners.includes(sliceCorner) ?? false;
  const single = useCornerSlices(
    sessionId,
    sliceCorner,
    !day && hasFile ? slicePointer?.hash ?? null : null,
  );
  const slices = day ? {...single, status: daySlices.status} : single;
  const {refetch: refetchSlices} = single;
  const traces = useMemo(() => {
    const out = new Map<string, GridTrace>();
    if (day) {
      day.members.forEach((m, i) => {
        const data = daySlices.data[i];
        if (!data) return;
        for (const lap of data.laps)
          if (sliceReachesApex(lap, data))
            out.set(dayLapId(m.id, lap.id), sliceToGridTrace(lap, data));
      });
      return out;
    }
    if (!single.data) return out;
    for (const lap of single.data.laps)
      if (sliceReachesApex(lap, single.data))
        out.set(lap.id, sliceToGridTrace(lap, single.data));
    return out;
  }, [single.data, day, daySlices.data]);
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
    if (!session.data || !laps.data || map.isPending) return {state: 'loading'};
    // A track with no map yet (null, a 404): no corners to draw.
    if (!map.data) return {state: 'missing', noMap: true};
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
          openingIds,
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
    bestLapId,
    openingIds,
    ranked,
    selection.hl,
    selection.ref,
    corner,
    whole,
    traceLoad,
    retryTraces,
    refetchSession,
    refetchLaps,
    refetchMap,
  ]);
}
