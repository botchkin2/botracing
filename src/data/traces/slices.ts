import {useQuery} from '@tanstack/react-query';

import {
  type CornerSlices,
  decodeCornerSlices,
} from '@/src/analysis/cornerSlices';

import {getJson, HttpError, retryUnlessClientError} from '../http';

/** Every React Query key for /sessions/{id}/corners/{n}/laps lives here. */
export const sliceKeys = {
  // The hash is content-addressed, so a key never holds stale data.
  corner: (sessionId: string, corner: number, hash: string) =>
    ['sessions', 'corner-slices', sessionId, corner, hash] as const,
};

/**
 * Every lap's window around one corner (docs/API.md). The hash comes from the
 * session doc (`slices.hash`); under it the response is immutable, and a hash
 * that has since been replaced answers 404. Like the field, the hash route is
 * cached for a year, so a body that fails to decode or parse is asked for once
 * more with `cache: 'reload'`; a failed status is not retried here.
 */
export async function fetchCornerSlices(
  sessionId: string,
  corner: number,
  hash: string,
  signal?: AbortSignal,
): Promise<CornerSlices> {
  const path = `/sessions/${encodeURIComponent(
    sessionId,
  )}/corners/${corner}/laps/${encodeURIComponent(hash)}`;
  try {
    return decodeCornerSlices(await getJson<unknown>(path, signal));
  } catch (error) {
    if (error instanceof HttpError || signal?.aborted) throw error;
    return decodeCornerSlices(
      await getJson<unknown>(path, signal, {cache: 'reload'}),
    );
  }
}

/**
 * The slices of one corner. Pass a null hash for a session that has none
 * (not yet resynced) or a corner without a file: nothing is fetched.
 */
export function useCornerSlices(
  sessionId: string,
  corner: number,
  hash: string | null,
) {
  return useQuery({
    queryKey: sliceKeys.corner(sessionId, corner, hash ?? ''),
    queryFn: ({signal}) => {
      // Unreachable: `enabled` is false without a hash.
      if (hash == null) throw new Error('corner slices: no hash');
      return fetchCornerSlices(sessionId, corner, hash, signal);
    },
    enabled: sessionId !== '' && hash != null,
    staleTime: Infinity,
    retry: retryUnlessClientError,
  });
}
