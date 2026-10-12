// Analysis on open (pit-wall thread 1 #4572): a session the API marks stale is
// analysed again in the cloud the first time it is read, and every cached
// answer about it is refetched when that lands. Plan and Track never trigger
// it; they read the stored values (decisions/lap/2026-10-12-analysis-on-open.md).
import {type QueryClient} from '@tanstack/react-query';

import {analyzeUrl, apiFetchAt} from '../http';
import {traceKeys} from '../traces/queries';

import {fetchSession} from './client';
import {sessionKeys} from './keys';

/** How often a session another open is running is read again, and for how long. */
export const POLL_MS = 3000;
export const POLL_FOR_MS = 120_000;

// Once per session per app run: a run that failed is not retried until the
// app starts again, so a broken session never loops.
const started = new Set<string>();
const running = new Set<string>();
const listeners = new Set<() => void>();

function changed() {
  for (const l of listeners) l();
}

/** For useSyncExternalStore: how many sessions are being analysed now. */
export const analysing = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  count: () => running.size,
};

export type AnalyzeDeps = {
  post(sessionId: string): Promise<{status: number}>;
  isStale(sessionId: string): Promise<boolean>;
  refetch(sessionId: string): Promise<void>;
  wait(ms: number): Promise<void>;
  now(): number;
};

/**
 * Analyse `sessionId` again: 200 means done; 202 means another open is
 * running it, so read the session until it is fresh. Any failure leaves the
 * stored session on screen. Returns whether fresh data was fetched.
 */
export async function analyzeOnce(
  sessionId: string,
  deps: AnalyzeDeps,
): Promise<boolean> {
  if (started.has(sessionId)) return false;
  started.add(sessionId);
  running.add(sessionId);
  changed();
  try {
    const {status} = await deps.post(sessionId);
    if (status === 202) {
      const until = deps.now() + POLL_FOR_MS;
      while (deps.now() < until) {
        await deps.wait(POLL_MS);
        if (!(await deps.isStale(sessionId))) break;
      }
    } else if (status !== 200) {
      console.warn(`analysis on open: ${sessionId} answered ${status}`);
      return false;
    }
    await deps.refetch(sessionId);
    return true;
  } catch (error) {
    console.warn(`analysis on open: ${sessionId} failed`, error);
    return false;
  } finally {
    running.delete(sessionId);
    changed();
  }
}

/** The app's bindings: the API, and every cached answer about the session. */
export function analyzeDeps(client: QueryClient): AnalyzeDeps {
  return {
    post: async id => {
      const res = await apiFetchAt(analyzeUrl(id), {method: 'POST'});
      // Only the function's own answer counts: a host without the route
      // answers its web page with a 200 (seen before Hosting deployed it).
      const body: unknown = await res.json().catch(() => null);
      const state = (body as {state?: unknown} | null)?.state;
      if (res.status === 200 && state !== 'done') return {status: 502};
      return {status: res.status};
    },
    isStale: async id => (await fetchSession(id)).stale,
    refetch: async id => {
      // The traces are cached by lap id: the laps the session has now.
      const laps = client.getQueryData<{id: string}[]>(sessionKeys.laps(id));
      for (const lap of laps ?? [])
        await client.invalidateQueries({queryKey: traceKeys.lap(lap.id)});
      await client.invalidateQueries({queryKey: sessionKeys.detail(id)});
      await client.invalidateQueries({queryKey: sessionKeys.laps(id)});
      await client.invalidateQueries({queryKey: sessionKeys.band(id)});
    },
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
}

/** Test seam: forget which sessions this run started. */
export function resetAnalysisOnOpen() {
  started.clear();
  running.clear();
}
