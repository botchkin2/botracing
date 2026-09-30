import {afterEach, describe, expect, it, jest} from '@jest/globals';

import {fetchField} from './client';

// The smallest field toField accepts: one update, no cars.
const good = {
  v: 2,
  hz: 5,
  et0: 0,
  tDs: [0],
  cars: [],
  lapDistDm: [],
  pathLateralDm: [],
  xDm: [],
  zDm: [],
  yawCrad: [],
  place: [],
  laps: [],
  inPits: [],
  flag: [],
};

const ok = (body: unknown) => ({ok: true, status: 200, json: async () => body});
const truncated = {
  ok: true,
  status: 200,
  json: async () => {
    throw new SyntaxError('Unexpected end of JSON input');
  },
};

function stubFetch(...responses: unknown[]) {
  const fetchMock = jest.fn<(url: string, init: RequestInit) => unknown>();
  responses.forEach(r => fetchMock.mockReturnValueOnce(r));
  (globalThis as {fetch?: unknown}).fetch = fetchMock;
  return fetchMock;
}

afterEach(() => {
  delete (globalThis as {fetch?: unknown}).fetch;
});

describe('fetchField', () => {
  it('asks once for a good body', async () => {
    const fetchMock = stubFetch(ok(good));
    const field = await fetchField('s1', 'abc');
    expect(field.hz).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].cache).toBeUndefined();
  });

  it('retries once with cache: reload after a truncated body', async () => {
    const fetchMock = stubFetch(truncated, ok(good));
    const field = await fetchField('s1', 'abc');
    expect(field.hz).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].cache).toBe('reload');
  });

  it('retries once after a body that is JSON but not a field', async () => {
    const fetchMock = stubFetch(ok({v: 2}), ok(good));
    await fetchField('s1', 'abc');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].cache).toBe('reload');
  });

  it('gives up after the second bad body', async () => {
    const fetchMock = stubFetch(truncated, truncated);
    await expect(fetchField('s1', 'abc')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failed status', async () => {
    const fetchMock = stubFetch({ok: false, status: 404});
    await expect(fetchField('s1', 'abc')).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
