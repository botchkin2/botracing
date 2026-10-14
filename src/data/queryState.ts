// What a screen shows from its reads (roadmap 6b, pit-wall thread 1 #5214 to
// #5219): what it has wins over an error. React Query keeps a query's last
// good data when a refetch fails; screens that put the error first went blank
// the moment the phone lost signal. Every screen model takes its state from
// queryState, so a new screen cannot bring that back.

import {lastApiAnswerAt} from './http';
import {AuthTokenError} from './tokenSource';

/** The parts of a React Query result this reads. */
export interface QueryLike {
  isError: boolean;
  isPending: boolean;
  error: unknown;
  data: unknown;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
}

export type QueryState =
  | {kind: 'loading'}
  // offlineSince: when the shown data was read, if a refetch failed for want
  // of a network since (the oldest of the screen's reads); null when current.
  | {kind: 'ready'; offlineSince: number | null}
  | {kind: 'offline'}
  | {kind: 'error'; message: string};

/**
 * The read failed for want of a network, not because the server said no: a
 * fetch that got no answer (a TypeError, whatever the platform words it:
 * 'Failed to fetch', 'Network request failed', 'Load failed'), or a token that
 * could not be refreshed (AuthTokenError). By class, never by message. Not
 * when the API answered another read after this one failed: then the network
 * works and this route is broken (a missing rewrite, a renamed endpoint), and
 * it must read as its error, not as "Offline" forever (torsion #5220).
 */
export function isOffline(
  error: unknown,
  failedAt: number,
  answeredAt: number = lastApiAnswerAt(),
): boolean {
  if (error instanceof AuthTokenError) return true;
  return error instanceof TypeError && answeredAt <= failedAt;
}

/**
 * One screen's state from the reads it cannot draw without. A read with data
 * is shown even when its refetch failed; only a read with nothing to show is
 * offline, an error or loading.
 */
export function queryState(
  queries: readonly QueryLike[],
  answeredAt: number = lastApiAnswerAt(),
): QueryState {
  const offline = (q: QueryLike) =>
    isOffline(q.error, q.errorUpdatedAt, answeredAt);
  const empty = queries.filter(q => q.data === undefined);
  const failed = empty.find(q => q.isError);
  if (failed) {
    if (offline(failed)) return {kind: 'offline'};
    const e = failed.error;
    return {kind: 'error', message: e instanceof Error ? e.message : String(e)};
  }
  if (empty.length > 0) return {kind: 'loading'};
  const stale = queries.filter(q => q.isError && offline(q));
  return {
    kind: 'ready',
    offlineSince: stale.length
      ? Math.min(...queries.map(q => q.dataUpdatedAt))
      : null,
  };
}
