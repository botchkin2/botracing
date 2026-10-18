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
  /** A day whose sessions were cut at different corner windows: Corner is off. */
  | {state: 'mixedDay'}
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
  // A day is its own model (data/sessions/lapSet.ts): its laps, its track, no
  // one session standing in for it. The URL names a day before it has loaded.
  const dayState = useDaySet(sessionId, route.data?.trackId, setKind === 'day');
  const day = dayState.state === 'ready' ? dayState.set : null;
  const dayPending = setKind === 'day' && dayState.state === 'loading';
  const dayFailed = setKind === 'day' && dayState.state === 'error';
  const map = useTrackMap(day ? day.trackId : route.data?.trackId);
  const lapData = day ? day.laps : routeLaps.data;
  const known = day != null || route.data != null;
  // The session's own opening rules; a day has its own (openingIds).
  const own = day || !route.data ? null : defaultSessionOf(route.data);

  const lapIds = useMemo(
    () =>
      !lapData
        ? []
        : day && selection.laps.length === 0 && !allComparable
        ? day.openingIds
        : cornerLapIds(lapData, selection, allComparable, own),
    [lapData, selection, allComparable, own, day],
  );
  // What Reset goes back to: the opening set, as Session and Compare open.
  const openingIds = useMemo(
    () =>
      day ? day.openingIds : lapData && own ? openingLapIds(lapData, own) : [],
    [lapData, own, day],
  );
  // The laps on: drawn in their own colour and named on the strips.
  const bestLapId = day
    ? dayBestLapId(day.laps)
    : route.data?.bestLapId ?? null;
  // The drawn laps, fastest first: "the best" and "the next" come from here.
  const ranked = useMemo(
    () =>
      (lapData ?? [])
        .filter(l => lapIds.includes(l.id) && l.timeS != null)
        .sort((a, b) => (a.timeS as number) - (b.timeS as number))
        .map(l => l.id),
    [lapData, lapIds],
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
  const slicePointer = day ? null : route.data?.slices ?? null;
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
        sessionKnown: known,
        hasFile,
        status: slices.status,
      }),
    [lapIds.length, known, hasFile, slices.status],
  );
  const retryTraces = useCallback(() => {
    void refetchSlices();
  }, [refetchSlices]);

  // Stable functions, so they can sit in the memo's dependencies.
  const {refetch: refetchSession} = route;
  const {refetch: refetchLaps} = routeLaps;
  const {refetch: refetchMap} = map;
  const error = [route, routeLaps, map].find(q => q.isError)?.error;
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
    if (dayFailed)
      return {
        state: 'error',
        message: 'the day did not load',
        retry: () => {
          void refetchSession();
          void refetchLaps();
        },
      };
    if (dayPending || !known || !lapData || map.isPending)
      return {state: 'loading'};
    // Corners cut at different windows are not one corner (daySet.ts).
    if (day && !day.usesSections) return {state: 'mixedDay'};
    // A track with no map yet (null, a 404): no corners to draw.
    if (!map.data) return {state: 'missing', noMap: true};
    if (lapIds.length === 0) return {state: 'noLaps'};
    const model = buildCornerModel({
      laps: lapData,
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
    dayFailed,
    dayPending,
    known,
    day,
    lapData,
    map.isPending,
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
