import {useQueries, useQueryClient} from '@tanstack/react-query';
import {useCallback, useMemo} from 'react';

import {
  type GridTrace,
  type RawTrace,
  resampleTrace,
  TRACE_HZ,
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
  grid: TraceGrid,
): (GridTrace | undefined)[] {
  return useLapTraceLoad(lapIds, grid).traces;
}

/**
 * The distance grid, and each lap's trace rate (rows per second, `Lap.traceHz`):
 * the clock is row / rate, 60 on iRacing. A lap not named reads at TRACE_HZ.
 */
export interface TraceGrid {
  lengthM: number;
  stepM: number;
  hzOf?: Readonly<Record<string, number>>;
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
  grid: TraceGrid,
  // How many of the first `lapIds` the person asked for; the rest are
  // fetched for a neighbouring lap and never count as a failure to show.
  asked = lapIds.length,
): LapTraceLoad {
  const {lengthM, stepM, hzOf} = grid;
  const client = useQueryClient();
  // One select per lap, stable while the grid and the rates are: a query
  // re-runs its select when the function changes, and a trace is big.
  const lapKey = lapIds.join(',');
  const selects = useMemo(
    () =>
      new Map(
        lapKey
          .split(',')
          .filter(Boolean)
          .map(id => [
            id,
            (raw: RawTrace) =>
              resampleTrace(raw, lengthM, stepM, hzOf?.[id] ?? TRACE_HZ),
          ]),
      ),
    [lapKey, lengthM, stepM, hzOf],
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
      select: selects.get(lapId),
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
