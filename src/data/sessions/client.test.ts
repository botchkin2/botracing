import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';

import {fetchSessionLaps, fetchTrackMap} from './client';

const realFetch = globalThis.fetch;
let calls: string[];

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({items: []}), {
      status: 200,
      headers: {'content-type': 'application/json'},
    });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('fetchSessionLaps', () => {
  it('asks for the laps of a real session id', async () => {
    await fetchSessionLaps('abc123');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/\/sessions\/abc123\/laps$/);
  });
});

describe('fetchTrackMap', () => {
  const answer = (status: number) => {
    globalThis.fetch = (async (url: string) => {
      calls.push(url);
      return new Response(status === 404 ? 'not found' : '{}', {status});
    }) as typeof fetch;
  };

  it('is null for a layout with no map (404): no map is an answer, not a failure', async () => {
    answer(404);
    await expect(fetchTrackMap('iracing-95-international')).resolves.toBeNull();
    expect(calls[0]).toMatch(/\/tracks\/iracing-95-international\/map$/);
  });

  it('still fails on a server error, so it can be retried', async () => {
    answer(500);
    await expect(fetchTrackMap('t')).rejects.toThrow();
  });
});
