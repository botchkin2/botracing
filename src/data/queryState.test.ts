import {describe, expect, it} from '@jest/globals';

import {HttpError} from './http';
import {isOffline, queryState, readFailure} from './queryState';
import {AuthTokenError} from './tokenSource';

// What fetch rejects with when no answer comes: web, React Native, Safari.
const web = new TypeError('Failed to fetch');
const android = new TypeError('Network request failed');
const safari = new TypeError('Load failed');
const serverError = new HttpError(500, '/sessions');

// Failures at t = 5000; the API last answered at t = 1000 (before them) unless a
// test says otherwise.
const FAILED_AT = 5000;
const BEFORE = 1000;
const q = (data: unknown, error: unknown = null, dataUpdatedAt = 1000) => ({
  isError: error !== null,
  isPending: data === undefined && error === null,
  error,
  data,
  dataUpdatedAt: data === undefined ? 0 : dataUpdatedAt,
  errorUpdatedAt: error === null ? 0 : FAILED_AT,
});
const state = (qs: ReturnType<typeof q>[], answeredAt = BEFORE) =>
  queryState(qs, answeredAt);

describe('queryState', () => {
  it('keeps what it has when a refetch fails for want of a network, and says since when', () => {
    expect(state([q({items: []}, web, 4000), q({a: 1}, null, 9000)])).toEqual({
      kind: 'ready',
      offlineSince: 4000,
    });
  });

  it('keeps what it has when a refetch fails at the server, with no offline line', () => {
    expect(state([q({items: []}, serverError)])).toEqual({
      kind: 'ready',
      offlineSince: null,
    });
  });

  it('is offline, not an error, with nothing to show and no network', () => {
    for (const e of [web, android, safari, new AuthTokenError(web)])
      expect(state([q({a: 1}), q(undefined, e)])).toEqual({kind: 'offline'});
  });

  it('is the server’s error with nothing to show', () => {
    expect(state([q(undefined, serverError)])).toEqual({
      kind: 'error',
      message: 'GET /sessions → 500',
    });
  });

  it('is loading while a read has nothing yet, and ready when all have', () => {
    expect(state([q({a: 1}), q(undefined)])).toEqual({kind: 'loading'});
    expect(state([q({a: 1}), q({b: 2})])).toEqual({
      kind: 'ready',
      offlineSince: null,
    });
  });
});

describe('isOffline', () => {
  it('is by class: never an answer from the server', () => {
    expect(isOffline(web, FAILED_AT, BEFORE)).toBe(true);
    expect(isOffline(new AuthTokenError(web), FAILED_AT, BEFORE)).toBe(true);
    expect(isOffline(serverError, FAILED_AT, BEFORE)).toBe(false);
    expect(isOffline(new HttpError(401, '/sessions'), FAILED_AT, BEFORE)).toBe(
      false,
    );
    expect(isOffline(new Error('Failed to fetch'), FAILED_AT, BEFORE)).toBe(
      false,
    );
  });

  it('is not offline when the API answered another read after this one failed: a broken route', () => {
    expect(isOffline(web, FAILED_AT, FAILED_AT + 1)).toBe(false);
    // A route nobody else answers around reads as its error, not Offline forever.
    expect(state([q({a: 1}), q(undefined, web)], FAILED_AT + 1)).toEqual({
      kind: 'error',
      message: 'Failed to fetch',
    });
  });
});

describe('readFailure', () => {
  it('is null while the read has data, whatever its refetch did', () => {
    expect(readFailure(q({a: 1}, web), BEFORE)).toBeNull();
    expect(readFailure(q({a: 1}, serverError), BEFORE)).toBeNull();
    expect(readFailure(q(undefined), BEFORE)).toBeNull();
  });

  it('says offline or error when nothing was read', () => {
    expect(readFailure(q(undefined, android), BEFORE)).toBe('offline');
    expect(readFailure(q(undefined, serverError), BEFORE)).toBe('error');
  });
});
