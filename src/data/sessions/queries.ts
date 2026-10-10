import {useQueries, useQuery} from '@tanstack/react-query';

import {retryUnlessClientError} from '../http';

import {
  fetchPlanSessions,
  fetchSession,
  fetchSessionFacets,
  fetchSessionBand,
  fetchSessionLaps,
  fetchTrackMap,
  fetchSessions,
  fetchTrackSurface,
} from './client';
import {type SessionFilter, sessionKeys} from './keys';

// A session is rewritten only by a resync, so detail data stays fresh for a
// while; the list refreshes sooner to pick up new uploads.
const DETAIL_STALE_MS = 5 * 60_000;
// A track map is curated (the server sends max-age 3600): an hour in memory too.
const TRACK_MAP_STALE_MS = 60 * 60_000;

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
    // `enabled` is false without a combo, so it is set whenever this runs.
    queryFn: ({signal}) => fetchPlanSessions(combo!, signal),
    staleTime: DETAIL_STALE_MS,
    // A plan restored from a persisted cache is shown at once and revalidated.
    refetchOnMount: true,
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

/**
 * A track layout's corner map, by track id: the same for every session at that
 * layout, so it needs no session and is fetched once (thread 1 #3479). Null or
 * '' (no session open yet, or its detail still loading): not fetched.
 */
export function useTrackMap(trackId: string | null | undefined) {
  return useQuery({
    queryKey: sessionKeys.trackMap(trackId ?? ''),
    queryFn: ({signal}) => fetchTrackMap(trackId as string, signal),
    enabled: !!trackId,
    // A reopen draws the kept copy (data/queryPersist.ts), then checks it once stale.
    refetchOnMount: true,
    // Curated: it changes only when the curator writes it.
    staleTime: TRACK_MAP_STALE_MS,
    retry: retryUnlessClientError,
  });
}

/**
 * The map of the layout an open session was driven on, for callers that hold
 * only the session id: its detail (usually cached already) names the track.
 * Null id: nothing fetched.
 */
export function useTrackMapOfSession(sessionId: string | null) {
  const session = useSession(sessionId ?? '', sessionId != null);
  return useTrackMap(session.data?.trackId);
}

/**
 * A track layout's measured surface; data is null until it has one. It grows
 * as sessions are folded in, so it is refetched on the same schedule as a
 * session's detail. A failed request is the same as none: the map draws as it
 * did before.
 */
export function useTrackSurface(trackId: string | null | undefined) {
  return useQuery({
    queryKey: sessionKeys.trackSurface(trackId ?? ''),
    queryFn: ({signal}) => fetchTrackSurface(trackId as string, signal),
    enabled: !!trackId,
    // A reopen draws the kept copy (data/queryPersist.ts), then checks it once stale.
    refetchOnMount: true,
    staleTime: DETAIL_STALE_MS,
    retry: retryUnlessClientError,
  });
}
