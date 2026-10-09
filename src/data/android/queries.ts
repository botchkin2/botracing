import {useQuery} from '@tanstack/react-query';

import {retryUnlessClientError} from '../http';

import {fetchAndroidRelease} from './client';
import {androidKeys} from './keys';

// A release is published rarely; a few minutes old is fine for the card.
export function useAndroidRelease({enabled}: {enabled: boolean}) {
  return useQuery({
    queryKey: androidKeys.latest,
    queryFn: ({signal}) => fetchAndroidRelease(signal),
    staleTime: 5 * 60_000,
    retry: retryUnlessClientError,
    enabled,
  });
}
