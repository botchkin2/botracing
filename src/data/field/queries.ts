import {useQuery} from '@tanstack/react-query';

import {retryUnlessClientError} from '../http';

import {fetchField} from './client';
import {fieldKeys} from './keys';

/**
 * The field of every car, from the session doc's `field.hash`. Pass a null
 * hash for a session with no field: nothing is fetched. A hash never changes
 * its content, so it is cached for good; a replaced hash 404s and the session
 * doc (refetched on its own schedule) points at the new one.
 */
export function useField(sessionId: string, hash: string | null) {
  return useQuery({
    queryKey: fieldKeys.detail(sessionId, hash ?? ''),
    queryFn: ({signal}) => {
      // Unreachable: `enabled` is false without a hash.
      if (hash == null) throw new Error('field: no hash');
      return fetchField(sessionId, hash, signal);
    },
    enabled: sessionId !== '' && hash != null,
    staleTime: Infinity,
    retry: retryUnlessClientError,
  });
}
