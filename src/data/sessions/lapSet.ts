import {useQueryClient} from '@tanstack/react-query';
import {useEffect, useMemo} from 'react';

import {sittingOf} from '@/src/analysis/sitting';

import {type Lap, type SessionDetail} from './adapters';
import {analyzeDeps, analyzeOnce} from './analysisOnOpen';
import {dayLapIds, mergeDayLaps} from './daySet';
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
      /** In start order; the first names the track and car. */
      members: SessionDetail[];
      /** Every member's laps, ids `sessionId~lapId` (daySet.ts mergeDayLaps). */
      laps: Lap[];
      stints: DayStint[];
      /** The laps the day opens on when the URL names none (daySet.ts dayLapIds): the protected rule run on the whole day. */
      openingIds: string[];
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
    current: !m.session.stale,
    laps: m.laps,
  }));
  const laps = mergeDayLaps(dayMembers);
  const startedAt = new Map(members.map(m => [m.session.id, m.session.startedAt]));
  const stints: DayStint[] = [];
  for (const lap of laps) {
    if (stints.some(s => s.n === lap.stint)) continue;
    const {sessionId} = splitDayLapId(lap.id);
    stints.push({n: lap.stint, sessionId, startedAt: startedAt.get(sessionId) ?? ''});
  }
  return {
    kind: 'day',
    members: members.map(m => m.session),
    laps,
    stints,
    openingIds: dayLapIds(dayMembers) ?? [],
  };
}

export type DayState =
  /** The session is in no sitting (or the list has not said): no day to offer. */
  | {state: 'none'}
  | {state: 'loading'}
  /** Members are being analysed again before the day can be judged. */
  | {state: 'waiting'; members: number}
  | {state: 'error'}
  | {state: 'ready'; set: DaySet};

/**
 * The sitting a session is in, as a LapSet, when `wanted` (the URL says
 * `?set=day`) or only to know whether there is one (`wanted` false: the ids,
 * for the toggle). A member made under other rules is analysed again by the
 * existing analysis-on-open path and the day waits for it (daySet.ts).
 */
export function useDaySet(
  sessionId: string,
  trackId: string | undefined,
  wanted: boolean,
): DayState & {ids: string[]} {
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
  const stale = details.details.filter(d => d?.stale).map(d => (d as SessionDetail).id);
  useEffect(() => {
    for (const id of stale) void analyzeOnce(id, analyzeDeps(client));
  }, [stale.join(','), client]);
  const result = useMemo((): DayState => {
    if (list.isError) return {state: 'error'};
    if (ids.length < 2) return list.isPending ? {state: 'loading'} : {state: 'none'};
    if (!wanted) return {state: 'none'};
    if (details.failed > 0 || lapsOf.failed > 0) return {state: 'error'};
    if (details.pending || lapsOf.pending) return {state: 'loading'};
    const members = details.details.map((session, i) => ({
      session: session as SessionDetail,
      laps: (lapsOf.laps[i] ?? []) as Lap[],
    }));
    if (members.some(m => m.session.stale))
      return {state: 'waiting', members: stale.length};
    return {state: 'ready', set: dayLapSet(members)};
  }, [list.isError, list.isPending, ids, wanted, details, lapsOf, stale.length]);
  return {...result, ids};
}

/** The one session as a LapSet; null while it loads. */
export function useSessionLapSet(id: string): LapSet | null {
  const session = useSession(id);
  const laps = useSessionLaps(id);
  return session.data && laps.data
    ? {kind: 'session', session: session.data, laps: laps.data}
    : null;
}
