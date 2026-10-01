import {useMemo} from 'react';

import {
  type Lap,
  type SessionDetail,
  useSessions,
  useSessionsLaps,
} from '@/src/data/sessions';

import {
  type Candidate,
  type PoolSource,
  poolSessions,
  referenceCandidates,
} from './referenceCandidates';

export type CandidatesState =
  | {kind: 'idle'}
  | {kind: 'loading'}
  | {kind: 'failed'}
  | {
      kind: 'ready';
      candidates: Candidate[];
      /** Other sessions at this track and car that the pool read. */
      sessions: number;
    };

/**
 * The reference candidates for a lap, from this session and the other sessions
 * at the same track and car. Nothing is fetched until `enabled`: the other
 * sessions' lap lists are the heavy part, so the person asks for them
 * (CODE_STANDARDS §0, flaky mobile data).
 */
export function useReferenceCandidates(
  session: SessionDetail,
  laps: Lap[],
  target: Lap,
  enabled: boolean,
): CandidatesState {
  const list = useSessions({trackId: session.trackId}, enabled);
  const pool = useMemo(
    () => (list.data ? poolSessions(session, list.data.items) : []),
    [list.data, session],
  );
  const pooled = useSessionsLaps(enabled ? pool.map(s => s.id) : []);
  return useMemo((): CandidatesState => {
    if (!enabled) return {kind: 'idle'};
    if (list.isError) return {kind: 'failed'};
    if (list.isPending || pooled.pending) return {kind: 'loading'};
    // A session whose laps failed is left out; the rest still rank.
    const others: PoolSource[] = pool.flatMap((s, i) => {
      const l = pooled.laps[i];
      return l ? [{session: s, laps: l}] : [];
    });
    return {
      kind: 'ready',
      candidates: referenceCandidates(target, session, laps, others),
      sessions: others.length,
    };
  }, [
    enabled,
    list.isError,
    list.isPending,
    pooled,
    pool,
    target,
    session,
    laps,
  ]);
}
