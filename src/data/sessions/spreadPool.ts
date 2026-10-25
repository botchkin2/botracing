import {useMemo} from 'react';

import {MIN_SPREAD_LAPS} from '@/src/analysis/spreadShare';
import {type PooledSession} from '@/src/analysis/sectionVary';
import {groupTwins} from '@/src/analysis/twinRuns';

import {type Lap, type SessionSummary, type TrackMapData} from './adapters';
import {useSessions, useSessionsLaps} from './queries';
import {turnSegmentTimes} from './segments';

// The earlier sessions a short session borrows for "which section varies most" (pit-wall thread 110, ticket 44):
// practices at the same track and car in the week before it, one per real run. Which sessions and what a lap
// becomes is pure; the hook below fetches them only when it is asked to.

/** How far back a session looks for company: the car, the track and the driver barely move in a week. */
export const POOL_WINDOW_DAYS = 7;

type Candidate = Pick<
  SessionSummary,
  | 'id'
  | 'trackId'
  | 'car'
  | 'sessionType'
  | 'startedAt'
  | 'lapCount'
  | 'comparableCount'
>;

const DAY_MS = 24 * 60 * 60 * 1000;

// The car as the session names it (the entry): stricter than the model, so it never pools two different cars; an entry
// the series suffix changes just finds fewer sessions, and the screen then says so.
const trackCarOf = (s: Pick<Candidate, 'trackId' | 'car'>) =>
  `${s.trackId}|${s.car}`;

/**
 * The sessions to pool with `current`, newest first: practices at its track and car that started inside
 * POOL_WINDOW_DAYS before it, one per real run (twinRuns.ts: a live capture and its game-file twin are one run, and
 * the twins of `current` itself are not company). A race or qualifying session pools with nothing.
 */
export function poolCandidates(
  current: Candidate,
  list: readonly Candidate[],
): Candidate[] {
  if (current.sessionType !== 'P') return [];
  const start = Date.parse(current.startedAt);
  const near = list.filter(
    s =>
      s.id !== current.id &&
      s.sessionType === 'P' &&
      s.lapCount > 0 &&
      Date.parse(s.startedAt) < start &&
      Date.parse(s.startedAt) >= start - POOL_WINDOW_DAYS * DAY_MS,
  );
  const withKey = (s: Candidate) => ({
    s,
    startedAt: s.startedAt,
    trackCar: trackCarOf(s),
  });
  const mine = trackCarOf(current);
  const groups = groupTwins([
    {s: current, startedAt: current.startedAt, trackCar: mine},
    ...near.map(withKey),
  ]);
  return groups
    .filter(g => g.every(x => x.s.id !== current.id) && g[0].trackCar === mine)
    .map(
      g =>
        g
          .map(x => x.s)
          .sort((a, b) => b.comparableCount - a.comparableCount)[0],
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** An earlier session as the ranking reads it: its comparable laps' section times, cut at the map's current windows; null with none. */
export function pooledSessionOf(
  s: Pick<SessionSummary, 'startedAt'>,
  laps: Lap[],
  map: TrackMapData,
): PooledSession | null {
  const times = turnSegmentTimes(laps, map);
  if (!times) return null;
  const mine = times.laps.filter(l => l.comparable);
  if (mine.length === 0) return null;
  return {
    startedAt: s.startedAt,
    laps: mine.map(l => ({timesS: l.timesS, offs: l.offs})),
  };
}

/** Whether a session is short enough to borrow earlier ones: under MIN_SPREAD_LAPS comparable laps. */
export const needsPool = (laps: readonly Pick<Lap, 'comparable'>[]): boolean =>
  laps.filter(l => l.comparable).length < MIN_SPREAD_LAPS;

/**
 * The earlier sessions of `current` for the ranking. Nothing is fetched unless `enabled`: the track's session list
 * (summaries) and then the laps of each candidate, only when the session itself has too few laps for a spread.
 */
export function useSpreadPool(
  current: Candidate | null,
  map: TrackMapData | null,
  enabled: boolean,
): PooledSession[] {
  const list = useSessions(
    {trackId: current?.trackId},
    enabled && current != null,
  );
  const candidates = useMemo(
    () =>
      enabled && current && list.data
        ? poolCandidates(current, list.data.items)
        : [],
    [enabled, current, list.data],
  );
  const laps = useSessionsLaps(candidates.map(c => c.id));
  return useMemo(() => {
    if (!map) return [];
    const out: PooledSession[] = [];
    candidates.forEach((c, i) => {
      const l = laps.laps[i];
      const s = l ? pooledSessionOf(c, l, map) : null;
      if (s) out.push(s);
    });
    return out;
  }, [candidates, laps.laps, map]);
}
