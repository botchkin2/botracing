import {useQuery} from '@tanstack/react-query';

import {retryUnlessClientError} from '../http';

import {fetchTrayRelease} from './client';
import {trayKeys} from './keys';

// A release is published rarely; a few minutes old is fine for the card.
export function useTrayRelease() {
  return useQuery({
    queryKey: trayKeys.latest,
    queryFn: ({signal}) => fetchTrayRelease(signal),
    staleTime: 5 * 60_000,
    retry: retryUnlessClientError,
  });
}
