import {afterEach, describe, expect, it, jest} from '@jest/globals';

import {setIdTokenProvider, setUnauthorizedListener} from './tokenSource';

import {apiBaseUrl, apiFetch, getJson, HttpError} from './http';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setIdTokenProvider(null);
  setUnauthorizedListener(null);
});

function stubFetch(status: number, body: unknown = {}) {
  const calls: {url: string; headers: Record<string, string>}[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify(body), {status});
  }) as typeof fetch;
  return calls;
}

describe('apiFetch', () => {
  it('sends no Authorization header when nobody is signed in', async () => {
    const calls = stubFetch(200);
    await apiFetch('/sessions');
    expect(calls[0].url).toBe(`${apiBaseUrl}/sessions`);
    expect(calls[0].headers.Authorization).toBeUndefined();
  });

  it('sends the signed-in ID token', async () => {
    setIdTokenProvider(async () => 'tok-1');
    const calls = stubFetch(200);
    await apiFetch('/sessions');
    expect(calls[0].headers.Authorization).toBe('Bearer tok-1');
  });

  it("keeps the caller's own headers too", async () => {
    setIdTokenProvider(async () => 'tok-1');
    const calls = stubFetch(200);
    await apiFetch('/x', {headers: {Accept: 'text/csv'}});
    expect(calls[0].headers).toEqual({
      Authorization: 'Bearer tok-1',
      Accept: 'text/csv',
    });
  });

  it('reports a 401 and still hands the response back', async () => {
    const listener = jest.fn();
    setUnauthorizedListener(listener);
    stubFetch(401, {error: 'sign in'});
    const response = await apiFetch('/sessions');
    expect(response.status).toBe(401);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not report other failures as a sign-in problem', async () => {
    const listener = jest.fn();
    setUnauthorizedListener(listener);
    for (const status of [403, 404, 500]) {
      stubFetch(status);
      await apiFetch('/sessions');
    }
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('getJson', () => {
  it('carries the token, parses the body and throws HttpError on 401', async () => {
    setIdTokenProvider(async () => 'tok-1');
    const calls = stubFetch(200, {items: [1]});
    expect(await getJson<{items: number[]}>('/sessions')).toEqual({items: [1]});
    expect(calls[0].headers.Authorization).toBe('Bearer tok-1');

    const listener = jest.fn();
    setUnauthorizedListener(listener);
    stubFetch(401);
    await expect(getJson('/sessions')).rejects.toBeInstanceOf(HttpError);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
