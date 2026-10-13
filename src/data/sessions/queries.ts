import {useQueries, useQuery, useQueryClient} from '@tanstack/react-query';
import {useEffect, useRef} from 'react';

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
import {analyzeDeps, analyzeOnce} from './analysisOnOpen';
import {type SessionFilter, sessionKeys} from './keys';
import {isLive, livePoll} from './live';

// A session is rewritten only by an upload or analysis on open (which
// refetches it itself), so detail data stays fresh for a while; the list
// refreshes sooner to pick up new uploads.
const DETAIL_STALE_MS = 5 * 60_000;
/**
 * The app's QueryClient never refetches on mount, focus or reconnect (utils/
 * queryClient.ts), so a screen showing what a drive, an upload or an analysis
 * changes must ask for it: a stale query is read again when its screen opens,
 * when the app comes back to the foreground and when the network returns.
 */
const FRESH_ON_RETURN = {
  refetchOnMount: true,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
} as const;
/** A live session gains a lap every minute or two: read it again sooner. */
const LIVE_STALE_MS = 30_000;
// A track map is curated (the server sends max-age 3600): an hour in memory too.
const TRACK_MAP_STALE_MS = 60 * 60_000;

export function useSessions(filter: SessionFilter = {}, enabled = true) {
  return useQuery({
    enabled,
    queryKey: sessionKeys.list(filter),
    queryFn: ({signal}) => fetchSessions(filter, signal),
    staleTime: 60_000,
    ...FRESH_ON_RETURN,
    retry: retryUnlessClientError,
  });
}

/** Games and tracks over all history, for the Sessions filter chips. */
export function useSessionFacets() {
  return useQuery({
    queryKey: sessionKeys.facets,
    queryFn: ({signal}) => fetchSessionFacets(signal),
    staleTime: 60_000,
    ...FRESH_ON_RETURN,
    retry: retryUnlessClientError,
  });
}

/** `enabled` false skips the fetch, for callers that only sometimes have an id. */
export function useSession(id: string, enabled = true) {
  const query = useQuery({
    enabled,
    queryKey: sessionKeys.detail(id),
    queryFn: ({signal}) => fetchSession(id, signal),
    staleTime: q =>
      isLive(q.state.data?.liveAt) ? LIVE_STALE_MS : DETAIL_STALE_MS,
    ...FRESH_ON_RETURN,
    // Read again while it is driven: a stale query refetches only on mount or
    // focus, so an open screen never saw the next lap (thread 1 #4983).
    refetchInterval: q => livePoll(q.state.data?.liveAt),
    retry: retryUnlessClientError,
  });
  // Opening a session made under older rules analyses it again in the cloud;
  // the stored numbers show until the new ones land (analysisOnOpen.ts). A
  // live session again for each lap the tray adds.
  const client = useQueryClient();
  const stale = query.data?.stale === true;
  const parts = query.data?.archiveParts ?? null;
  // dataUpdatedAt: a lap that landed while an analysis ran is tried again once
  // that analysis has refetched the session, not at the lap after.
  const readAt = query.dataUpdatedAt;
  useEffect(() => {
    if (stale)
      void analyzeOnce(id, analyzeDeps(client), `${id}#${parts ?? ''}`);
  }, [stale, id, parts, client, readAt]);
  // The lap table and band are other queries (5 min stale): when the doc is
  // rewritten under an open screen, by a lap upload or by an analysis another
  // device ran, they are read again with it.
  const docAt = query.data?.updatedAt;
  const seen = useRef<{id: string; at: string} | null>(null);
  useEffect(() => {
    if (!docAt) return;
    const was = seen.current;
    if (was && was.id === id && was.at !== docAt) {
      void client.invalidateQueries({queryKey: sessionKeys.laps(id)});
      void client.invalidateQueries({queryKey: sessionKeys.band(id)});
    }
    seen.current = {id, at: docAt};
  }, [docAt, id, client]);
  return query;
}

export function useSessionLaps(id: string | null) {
  return useQuery({
    queryKey: sessionKeys.laps(id ?? ''),
    // Only runs when enabled, so the id is set here.
    queryFn: ({signal}) => fetchSessionLaps(id!, signal),
    enabled: id != null,
    staleTime: DETAIL_STALE_MS,
    ...FRESH_ON_RETURN,
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
    ...FRESH_ON_RETURN,
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
