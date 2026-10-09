import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';

import {fetchSessionLaps} from './client';

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
