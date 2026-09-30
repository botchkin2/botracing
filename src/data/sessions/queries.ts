import {useQueries, useQuery} from '@tanstack/react-query';

import {retryUnlessClientError} from '../http';

import {
  fetchSession,
  fetchSessionBand,
  fetchSessionLaps,
  fetchSessionMap,
  fetchSessions,
} from './client';
import {type SessionFilter, sessionKeys} from './keys';

// A session is rewritten only by a resync, so detail data stays fresh for a
// while; the list refreshes sooner to pick up new uploads.
const DETAIL_STALE_MS = 5 * 60_000;

export function useSessions(filter: SessionFilter = {}, enabled = true) {
  return useQuery({
    enabled,
    queryKey: sessionKeys.list(filter),
    queryFn: ({signal}) => fetchSessions(filter, signal),
    staleTime: 60_000,
    retry: retryUnlessClientError,
  });
}

/** `enabled` false skips the fetch, for callers that only sometimes have an id. */
export function useSession(id: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: sessionKeys.detail(id),
    queryFn: ({signal}) => fetchSession(id, signal),
    staleTime: DETAIL_STALE_MS,
    retry: retryUnlessClientError,
  });
}

export function useSessionLaps(id: string) {
  return useQuery({
    queryKey: sessionKeys.laps(id),
    queryFn: ({signal}) => fetchSessionLaps(id, signal),
    staleTime: DETAIL_STALE_MS,
    retry: retryUnlessClientError,
  });
}

/** The laps of several sessions at once, with the same keys as `useSessionLaps`. */
export function useSessionsLaps(ids: string[]) {
  return useQueries({
    queries: ids.map(id => ({
      queryKey: sessionKeys.laps(id),
      queryFn: ({signal}: {signal: AbortSignal}) =>
        fetchSessionLaps(id, signal),
      staleTime: DETAIL_STALE_MS,
      retry: retryUnlessClientError,
    })),
    combine: results => ({
      laps: results.map(r => r.data),
      pending: results.some(r => r.isPending),
      failed: results.filter(r => r.isError).length,
    }),
  });
}

/** The detail docs of several sessions at once, with the keys of `useSession`. */
export function useSessionsDetail(ids: string[]) {
  return useQueries({
    queries: ids.map(id => ({
      queryKey: sessionKeys.detail(id),
      queryFn: ({signal}: {signal: AbortSignal}) => fetchSession(id, signal),
      staleTime: DETAIL_STALE_MS,
      retry: retryUnlessClientError,
    })),
    combine: results => ({details: results.map(r => r.data)}),
  });
}

export function useSessionBand(id: string) {
  return useQuery({
    queryKey: sessionKeys.band(id),
    queryFn: ({signal}) => fetchSessionBand(id, signal),
    staleTime: DETAIL_STALE_MS,
    retry: retryUnlessClientError,
  });
}

export function useSessionMap(id: string) {
  return useQuery({
    queryKey: sessionKeys.map(id),
    queryFn: ({signal}) => fetchSessionMap(id, signal),
    // The chrome asks with no session open; don't fetch then.
    enabled: id !== '',
    staleTime: DETAIL_STALE_MS,
    retry: retryUnlessClientError,
  });
}
