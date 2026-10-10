import {useQueries, useQuery} from '@tanstack/react-query';

import {retryUnlessClientError} from '../http';

import {
  fetchPlanSessions,
  fetchSession,
  fetchSessionFacets,
  fetchSessionBand,
  fetchSessionLaps,
  fetchSessionMap,
  fetchSessions,
  fetchSessionSurface,
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

/** Games and tracks over all history, for the Sessions filter chips. */
export function useSessionFacets() {
  return useQuery({
    queryKey: sessionKeys.facets,
    queryFn: ({signal}) => fetchSessionFacets(signal),
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

export function useSessionLaps(id: string | null) {
  return useQuery({
    queryKey: sessionKeys.laps(id ?? ''),
    // Only runs when enabled, so the id is set here.
    queryFn: ({signal}) => fetchSessionLaps(id!, signal),
    enabled: id != null,
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
      enabled: id !== '',
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
    combine: results => ({
      details: results.map(r => r.data),
      // Loading, not failed: a query that errored has no data either.
      pending: results.some(r => r.isPending),
      failed: results.filter(r => r.isError).length,
    }),
  });
}

/**
 * The plan blocks of one track and car, in one request. `enabled` false skips
 * it (no combo chosen yet). A plan changes only when a session is resynced.
 */
export function usePlanSessions(
  combo: {sim: string; trackId: string; carModel: string} | null,
) {
  return useQuery({
    enabled: combo != null,
    queryKey: sessionKeys.plan(
      combo?.sim ?? '',
      combo?.trackId ?? '',
      combo?.carModel ?? '',
    ),
    queryFn: ({signal}) => fetchPlanSessions(combo!, signal),
    staleTime: DETAIL_STALE_MS,
    retry: retryUnlessClientError,
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

/**
 * The track's measured surface; data is null until the track has one. The
 * file grows as sessions are folded in, so it is refetched on the same
 * schedule as a session's detail. A failed request is the same as none: the
 * map draws as it did before.
 */
export function useSessionSurface(id: string) {
  return useQuery({
    queryKey: sessionKeys.surface(id),
    queryFn: ({signal}) => fetchSessionSurface(id, signal),
    enabled: id !== '',
    staleTime: DETAIL_STALE_MS,
    retry: retryUnlessClientError,
  });
}
