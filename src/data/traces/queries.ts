import {useQueries, useQueryClient} from '@tanstack/react-query';
import {useCallback, useMemo} from 'react';

import {
  type GridTrace,
  type RawTrace,
  resampleTrace,
} from '@/src/analysis/resample';

import {apiFetch, HttpError, retryUnlessClientError} from '../http';

import {traceLoad, type TraceLoad} from './loadState';
import {parseTraceCsv} from './parse';

export const traceKeys = {
  lap: (lapId: string) => ['laps', 'trace', lapId] as const,
};

async function fetchLapTrace(
  lapId: string,
  signal?: AbortSignal,
): Promise<RawTrace> {
  const path = `/laps/${encodeURIComponent(lapId)}/csv`;
  const response = await apiFetch(path, {signal});
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
  return useLapTraceLoad(lapIds, grid).traces;
}

export interface LapTraceLoad {
  traces: (GridTrace | undefined)[];
  load: TraceLoad;
  /** Refetches only the laps whose trace failed. */
  retry: () => void;
}

/** `useLapTraces` plus what to tell the person about a slow or failed load. */
export function useLapTraceLoad(
  lapIds: string[],
  grid: {lengthM: number; stepM: number},
  // How many of the first `lapIds` the person asked for; the rest are
  // fetched for a neighbouring lap and never count as a failure to show.
  asked = lapIds.length,
): LapTraceLoad {
  const {lengthM, stepM} = grid;
  const client = useQueryClient();
  const select = useCallback(
    (raw: RawTrace) => resampleTrace(raw, lengthM, stepM),
    [lengthM, stepM],
  );
  const results = useQueries({
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
    combine: rs => rs.map(r => ({data: r.data, status: r.status})),
  });
  const traces = useMemo(() => results.map(r => r.data), [results]);
  // While the grid length is unknown nothing is fetched: still loading.
  const load = useMemo(
    () => traceLoad(results.slice(0, asked).map(r => r.status)),
    [results, asked],
  );
  const retry = useCallback(() => {
    lapIds.forEach((lapId, i) => {
      if (results[i]?.status === 'error')
        void client.refetchQueries({
          queryKey: traceKeys.lap(lapId),
          exact: true,
        });
    });
  }, [client, lapIds, results]);
  return {traces, load, retry};
}
