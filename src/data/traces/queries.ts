import {useQueries} from '@tanstack/react-query';
import {useCallback} from 'react';

import {
  type GridTrace,
  type RawTrace,
  resampleTrace,
} from '@/src/analysis/resample';

import {apiBaseUrl, HttpError, retryUnlessClientError} from '../http';

import {parseTraceCsv} from './parse';

export const traceKeys = {
  lap: (lapId: string) => ['laps', 'trace', lapId] as const,
};

async function fetchLapTrace(
  lapId: string,
  signal?: AbortSignal,
): Promise<RawTrace> {
  const path = `/laps/${encodeURIComponent(lapId)}/csv`;
  const response = await fetch(`${apiBaseUrl}${path}`, {signal});
  if (!response.ok) throw new HttpError(response.status, path);
  return parseTraceCsv(await response.text());
}

/**
 * Each lap's trace on a shared distance grid. One query per lap, so adding a
 * lap fetches only that lap; `select` resamples once per trace and grid.
 */
export function useLapTraces(
  lapIds: string[],
  grid: {lengthM: number; stepM: number},
): (GridTrace | undefined)[] {
  const {lengthM, stepM} = grid;
  const select = useCallback(
    (raw: RawTrace) => resampleTrace(raw, lengthM, stepM),
    [lengthM, stepM],
  );
  return useQueries({
    queries: lapIds.map(lapId => ({
      queryKey: traceKeys.lap(lapId),
      queryFn: ({signal}: {signal: AbortSignal}) =>
        fetchLapTrace(lapId, signal),
      // A lap's trace never changes once uploaded.
      staleTime: Infinity,
      retry: retryUnlessClientError,
      enabled: lengthM > 0,
      select,
    })),
    combine: results => results.map(r => r.data),
  });
}
