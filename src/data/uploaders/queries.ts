import {useQuery} from '@tanstack/react-query';

import {retryUnlessClientError} from '../http';

import {fetchUploaders} from './client';
import {uploaderKeys} from './keys';

// A heartbeat is at most 5 min old when the uploader runs; refetch every
// minute while Settings is open so the dot and "seen" time stay current.
export function useUploaders() {
  return useQuery({
    queryKey: uploaderKeys.all,
    queryFn: ({signal}) => fetchUploaders(signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: retryUnlessClientError,
  });
}
