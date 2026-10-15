import {afterEach, describe, expect, it, jest} from '@jest/globals';
import {QueryClient, QueryObserver} from '@tanstack/react-query';

import {retryUnlessClientError} from '../http';
import {AuthTokenError} from '../tokenSource';

import {LIVE_POLL_MS} from './live';

// A live session's poll while the token cannot be refreshed (signed in, no
// signal): the retries of one poll and the next poll never overlap, so a minute
// offline is a bounded number of attempts, and the last data stays shown.
afterEach(() => {
  jest.useRealTimers();
});

describe('the live poll with no token', () => {
  it('does not stack requests and keeps the data it had', async () => {
    jest.useFakeTimers();
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retryDelay: attempt => Math.min(1000 * 2 ** attempt, 30000),
        },
      },
    });
    let calls = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    let offline = false;
    const observer = new QueryObserver(client, {
      queryKey: ['session', 'live'],
      queryFn: async () => {
        calls++;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(r => setTimeout(r, 300));
        inFlight--;
        if (offline) throw new AuthTokenError(new Error('offline'));
        return {lapCount: 3};
      },
      refetchInterval: LIVE_POLL_MS,
      retry: retryUnlessClientError,
    });
    const unsubscribe = observer.subscribe(() => {});
    await jest.advanceTimersByTimeAsync(1000);
    offline = true;
    calls = 0;
    await jest.advanceTimersByTimeAsync(60_000);
    const result = observer.getCurrentResult();
    unsubscribe();
    client.clear();

    expect(maxInFlight).toBe(1);
    // Each poll is one attempt and 3 retries (0.3 s each, 1 + 2 + 4 s
    // backoff), then the next poll after LIVE_POLL_MS: about 24 attempts in
    // the minute at a 2 s poll, and it keeps trying.
    const cycleS = 4 * 0.3 + 7 + LIVE_POLL_MS / 1000;
    expect(calls).toBeGreaterThanOrEqual(12);
    expect(calls).toBeLessThanOrEqual(Math.ceil((60 / cycleS) * 4) + 1);
    expect(result.data).toEqual({lapCount: 3});
  });
});
