import {useQuery} from '@tanstack/react-query';

import {retryUnlessClientError} from '../http';

import {fetchSession, fetchSessionLaps, fetchSessions} from './client';
import {type SessionFilter, sessionKeys} from './keys';

// A session is rewritten only by a resync, so detail data stays fresh for a
// while; the list refreshes sooner to pick up new uploads.
const DETAIL_STALE_MS = 5 * 60_000;

export function useSessions(filter: SessionFilter = {}) {
  return useQuery({
    queryKey: sessionKeys.list(filter),
    queryFn: ({signal}) => fetchSessions(filter, signal),
    staleTime: 60_000,
    retry: retryUnlessClientError,
  });
}

export function useSession(id: string) {
  return useQuery({
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
