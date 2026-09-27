import {useQuery} from '@tanstack/react-query';

import {retryUnlessClientError} from '../http';

import {fetchSessions} from './client';
import {type SessionFilter, sessionKeys} from './keys';

export function useSessions(filter: SessionFilter = {}) {
  return useQuery({
    queryKey: sessionKeys.list(filter),
    queryFn: ({signal}) => fetchSessions(filter, signal),
    staleTime: 60_000,
    retry: retryUnlessClientError,
  });
}
