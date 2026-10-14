import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';

import {
  fetchSessionLaps,
  fetchSessions,
  fetchTrackMap,
  forgetListAnswers,
} from './client';

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

describe('fetchSessions version', () => {
  const sent: string[] = [];
  const server = (bodies: unknown[]) => {
    sent.length = 0;
    globalThis.fetch = (async (url: string) => {
      sent.push(url);
      return new Response(JSON.stringify(bodies.shift()), {status: 200});
    }) as typeof fetch;
  };
  beforeEach(() => forgetListAnswers());

  it('sends the held version and keeps the held list on {unchanged}', async () => {
    server([
      {items: [], total: 0, version: 'v1'},
      {unchanged: true, version: 'v1'},
      {items: [], total: 0, version: 'v2'},
    ]);
    const first = await fetchSessions({ageDays: 30});
    const second = await fetchSessions({ageDays: 30});
    expect(second).toBe(first);
    await fetchSessions({ageDays: 30});
    expect(sent[0]).toMatch(/\/sessions\?age=30$/);
    expect(sent[1]).toMatch(/\/sessions\?age=30&v=v1$/);
    expect(sent[2]).toMatch(/\/sessions\?age=30&v=v1$/);
  });

  it('keeps a version per request, and none from a server that sends none', async () => {
    server([
      {items: [], total: 0},
      {items: [], total: 0},
    ]);
    await fetchSessions({ageDays: 30});
    await fetchSessions({ageDays: 30});
    expect(sent[1]).not.toMatch(/v=/);
  });
});
