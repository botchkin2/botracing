import {useQueryClient} from '@tanstack/react-query';
import {useCallback, useEffect, useMemo} from 'react';

import {sittingOf} from '@/src/analysis/sitting';

import {type Lap, type SessionDetail} from './adapters';
import {analyzeDeps, analyzeOnce} from './analysisOnOpen';
import {dayLapIds, dayUsesSections, mergeDayLaps} from './daySet';
import {
  useSession,
  useSessionLaps,
  useSessions,
  useSessionsDetail,
  useSessionsLaps,
} from './queries';

// The set of laps a Session screen describes (pit-wall thread 88, chord's
// call): a session is a set of one; a day is the sessions of a sitting run back
// to back, derived from the sessions list, never stored. The set cards (lap
// times, consistency, optimal, spread, ledger, sections) read `laps`; the
// session cards (fuel, tyres, field, Race, the pit review) are not facts of a
// set and are drawn only for a session.

/** One stint of a day, named by the session it belongs to. */
export type DayStint = {
  /** The merged stint number (a stint never spans two sessions). */
  n: number;
  sessionId: string;
  startedAt: string;
};

export type LapSet =
  | {kind: 'session'; session: SessionDetail; laps: Lap[]}
  | {
      kind: 'day';
      /** The track every member ran (a sitting is one track and car, sitting.ts). */
      trackId: string;
      /** The car as the sessions name it. */
      car: string;
      /** In start order. */
      members: SessionDetail[];
      /** Every member's laps, ids `sessionId~lapId` (daySet.ts mergeDayLaps). */
      laps: Lap[];
      stints: DayStint[];
      /** The laps the day opens on when the URL names none (daySet.ts dayLapIds): the protected rule run on the whole day. */
      openingIds: string[];
      /** Every member was cut at the same corner windows (daySet.ts dayUsesSections): false = no view may mix their corners. */
      usesSections: boolean;
    };

export type DaySet = Extract<LapSet, {kind: 'day'}>;

/** The id of a merged lap's own session, and its lap id there. */
export function splitDayLapId(id: string): {sessionId: string; lapId: string} {
  const at = id.indexOf('~');
  return at < 0
    ? {sessionId: '', lapId: id}
    : {sessionId: id.slice(0, at), lapId: id.slice(at + 1)};
}

/** The members' laps as one day, in the order given (start order). */
export function dayLapSet(
  members: readonly {session: SessionDetail; laps: Lap[]}[],
): DaySet {
  const dayMembers = members.map(m => ({
    sessionId: m.session.id,
    laps: m.laps,
  }));
  const laps = mergeDayLaps(dayMembers);
  const startedAt = new Map(
    members.map(m => [m.session.id, m.session.startedAt]),
  );
  const stints: DayStint[] = [];
  for (const lap of laps) {
    if (stints.some(s => s.n === lap.stint)) continue;
    const {sessionId} = splitDayLapId(lap.id);
    stints.push({
      n: lap.stint,
      sessionId,
      startedAt: startedAt.get(sessionId) ?? '',
    });
  }
  return {
    kind: 'day',
    trackId: members[0].session.trackId,
    car: members[0].session.car,
    members: members.map(m => m.session),
    laps,
    stints,
    openingIds: dayLapIds(dayMembers),
    usesSections: dayUsesSections(dayMembers),
  };
}

export type DayState =
  /** The session is in no sitting (or the list has not said): no day to offer. */
  | {state: 'none'}
  | {state: 'loading'}
  | {state: 'error'}
  | {state: 'ready'; set: DaySet};

/**
 * The sitting a session is in, as a LapSet, when `wanted` (the URL says
 * `?set=day`) or only to know whether there is one (`wanted` false: the ids,
 * for the toggle). The day is computed from the members' stored laps as they
 * are (daySet.ts reads section times only under identical boundary stamps); a
 * member made under other rules is analysed again through the existing
 * analysis-on-open path, one at a time, to bring it current, and the view does
 * not wait for it (chord #6021, gauge #6019).
 */
export function useDaySet(
  sessionId: string,
  trackId: string | undefined,
  wanted: boolean,
): DayState & {ids: string[]; retry: () => void} {
  const client = useQueryClient();
  const list = useSessions({trackId}, trackId != null);
  const ids = useMemo(() => {
    const items = list.data?.items ?? [];
    const set = sittingOf(
      items.map(s => ({
        id: s.id,
        trackId: s.trackId,
        // The car as the session names it (livery and entry included): the
        // same car, not only the same model.
        carModel: s.car,
        sessionType: s.sessionType,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
      })),
      sessionId,
    );
    return set ? set.map(s => s.id) : [];
  }, [list.data, sessionId]);
  const load = wanted ? ids : [];
  const details = useSessionsDetail(load);
  const lapsOf = useSessionsLaps(load);
  const stale = details.details
    .filter(d => d?.stale)
    .map(d => (d as SessionDetail).id);
  const staleKey = stale.join(',');
  // One cloud analysis at a time: a day can hold five stale sessions.
  useEffect(() => {
    let live = true;
    void (async () => {
      for (const id of staleKey ? staleKey.split(',') : []) {
        if (!live) return;
        await analyzeOnce(id, analyzeDeps(client));
      }
    })();
    return () => {
      live = false;
    };
  }, [staleKey, client]);
  // The query results are new arrays every render; the day is rebuilt only
  // when a member's detail or laps are new data (the merge and the slow rule
  // run over the whole day).
  const detailList = useStableList(details.details);
  const lapList = useStableList(lapsOf.laps);
  const result = useMemo((): DayState => {
    if (list.isError) return {state: 'error'};
    if (ids.length < 2)
      return list.isPending ? {state: 'loading'} : {state: 'none'};
    if (!wanted) return {state: 'none'};
    if (details.failed > 0 || lapsOf.failed > 0) return {state: 'error'};
    if (details.pending || lapsOf.pending) return {state: 'loading'};
    const members = detailList.map((session, i) => ({
      session: session as SessionDetail,
      laps: (lapList[i] ?? []) as Lap[],
    }));
    return {state: 'ready', set: dayLapSet(members)};
  }, [
    list.isError,
    list.isPending,
    ids,
    wanted,
    detailList,
    lapList,
    details.failed,
    details.pending,
    lapsOf.failed,
    lapsOf.pending,
  ]);
  const {refetch: refetchList} = list;
  const {refetch: refetchDetails} = details;
  const {refetch: refetchLaps} = lapsOf;
  const retry = useCallback(() => {
    if (list.isError) void refetchList();
    refetchDetails();
    refetchLaps();
  }, [list.isError, refetchList, refetchDetails, refetchLaps]);
  return {...result, ids, retry};
}

/** The one session as a LapSet; null while it loads. */
export function useSessionLapSet(id: string): LapSet | null {
  const session = useSession(id);
  const laps = useSessionLaps(id);
  return session.data && laps.data
    ? {kind: 'session', session: session.data, laps: laps.data}
    : null;
}

// An id per object, so a list of query results has a signature that changes
// only when one of them is new data.
const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (x: unknown): string => {
  if (x == null || typeof x !== 'object') return String(x);
  let id = ids.get(x);
  if (id == null) ids.set(x, (id = nextId++));
  return String(id);
};

/** The same array while its elements are the same objects: `useQueries` hands back a new one each render. */
function useStableList<T>(items: readonly T[]): readonly T[] {
  const signature = items.map(idOf).join(',');
  return useMemo(() => items, [signature]);
}

/** Whether the day in the URL cannot show Corner: its sessions were cut at different windows. */
export function useCornerOff(
  sessionId: string,
  trackId: string | undefined,
  wanted: boolean,
): boolean {
  const day = useDaySet(sessionId, trackId, wanted);
  return day.state === 'ready' && !day.set.usesSections;
}
