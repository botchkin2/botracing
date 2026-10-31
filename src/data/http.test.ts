import {afterEach, describe, expect, it, jest} from '@jest/globals';

import {
  AuthTokenError,
  setIdTokenProvider,
  setUnauthorizedListener,
} from './tokenSource';

import {
  ANSWER_TIMEOUT_MS,
  apiBaseUrl,
  apiFetch,
  getJson,
  HttpError,
  NoAnswerError,
  retryUnlessClientError,
} from './http';

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

  it('a failed token refresh sends nothing and asks nobody to sign in, and is retried', async () => {
    const listener = jest.fn();
    setUnauthorizedListener(listener);
    setIdTokenProvider(async () => {
      throw new Error('auth/network-request-failed');
    });
    const calls = stubFetch(200);
    const thrown = await apiFetch('/sessions').catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(AuthTokenError);
    expect(calls).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
    expect(retryUnlessClientError(0, thrown)).toBe(true);
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

// Ticket 87: a connection that never answers must end in an error, and a slow
// body must not be cut by the same timer.
describe('apiFetch answer timeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects when no response headers arrive in time', async () => {
    jest.useFakeTimers();
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        );
      })) as typeof fetch;
    const pending = apiFetch('/sessions');
    const outcome = expect(pending).rejects.toBeInstanceOf(NoAnswerError);
    await jest.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS);
    await outcome;
  });

  it('does not abort a body that is still arriving after the timeout', async () => {
    jest.useFakeTimers();
    let aborted = false;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true;
      });
      return new Response('{}', {status: 200});
    }) as typeof fetch;
    const response = await apiFetch('/sessions');
    await jest.advanceTimersByTimeAsync(ANSWER_TIMEOUT_MS * 3);
    expect(aborted).toBe(false);
    expect(response.status).toBe(200);
  });

  it('a caller abort after the headers still stops the body read', async () => {
    const caller = new AbortController();
    globalThis.fetch = (async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: () =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('body aborted')),
          );
        }),
    })) as unknown as typeof fetch;
    const response = await apiFetch('/sessions', {signal: caller.signal});
    const body = response.json();
    caller.abort();
    await expect(body).rejects.toThrow('body aborted');
  });

  it('passes a caller abort through', async () => {
    const caller = new AbortController();
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        // As the real fetch: an already aborted signal rejects at once.
        if (init?.signal?.aborted) reject(new Error('caller aborted'));
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('caller aborted')),
        );
      })) as typeof fetch;
    const pending = apiFetch('/sessions', {signal: caller.signal});
    caller.abort();
    await expect(pending).rejects.toThrow('caller aborted');
  });
});
