import {afterEach, describe, expect, it, jest} from '@jest/globals';

import {
  type AuthState,
  accountLabel,
  gateView,
  unauthorizedPrompt,
  userChanged,
} from './authState';
import {applyAuthState, type AuthStore} from './authStore';
import {popupFallsBackToRedirect, signInMessage} from './signInResult';
import {
  authHeaders,
  beginAuthWait,
  endAuthWait,
  bearer,
  reportUnauthorized,
  setIdTokenProvider,
  setUnauthorizedListener,
} from '../data/tokenSource';

const loading: AuthState = {kind: 'loading'};
const out: AuthState = {kind: 'signed-out'};
const a: AuthState = {kind: 'signed-in', uid: 'uidA', email: 'a@x.test'};
const b: AuthState = {kind: 'signed-in', uid: 'uidB', email: null};

describe('accountLabel and unauthorizedPrompt', () => {
  it('says who is signed in, or that nobody is', () => {
    expect(accountLabel(loading)).toBe('Checking sign-in…');
    expect(accountLabel(out)).toBe('Not signed in');
    expect(accountLabel(a)).toBe('a@x.test');
    expect(accountLabel(b)).toBe('Signed in');
  });

  it('tells signed-out from a refused token', () => {
    expect(unauthorizedPrompt(out, true)).toBe('Sign in to see your sessions.');
    expect(unauthorizedPrompt(a, true)).toMatch(/Sign in again/);
  });

  it('says plainly that a build without sign-in needs an update', () => {
    for (const state of [out, a]) {
      const text = unauthorizedPrompt(state, false);
      expect(text).toMatch(/cannot sign in yet/);
      expect(text).toMatch(/update/);
      expect(text).not.toMatch(/Sign in with/);
    }
  });
});

describe('gateView: what the app shows', () => {
  it('web (sign-in required): blank while loading, login when signed out, app when signed in', () => {
    expect(gateView(loading, true)).toBe('blank');
    expect(gateView(out, true)).toBe('login');
    expect(gateView(a, true)).toBe('app');
    expect(gateView(b, true)).toBe('app');
  });

  it('never shows the login screen to a signed-in person or while the answer is unknown', () => {
    // Marshal #180: a login flash on every load is a bug of its own.
    for (const state of [loading, a, b])
      expect(gateView(state, true)).not.toBe('login');
  });

  it('a build that cannot sign in yet (the Android app) always shows the app', () => {
    for (const state of [loading, out, a])
      expect(gateView(state, false)).toBe('app');
  });
});

describe('userChanged', () => {
  it('is true only when the person is different', () => {
    expect(userChanged(out, a)).toBe(true);
    expect(userChanged(a, out)).toBe(true);
    expect(userChanged(a, b)).toBe(true);
    expect(userChanged(a, a)).toBe(false);
    expect(userChanged(out, out)).toBe(false);
    // The same uid with a new email is still the same person.
    expect(userChanged(a, {...a, email: 'new@x.test'})).toBe(false);
  });

  it('treats loading as not-yet-known, not as a change', () => {
    expect(userChanged(a, loading)).toBe(false);
    expect(userChanged(out, loading)).toBe(false);
    // The first answer after loading: signed in changes what was fetched
    // token-less in the meantime; signed out does not.
    expect(userChanged(loading, a)).toBe(true);
    expect(userChanged(loading, out)).toBe(false);
  });
});

function fakeStore(state: AuthState): AuthStore & {
  calls: string[];
} {
  const calls: string[] = [];
  const store = {
    state,
    unauthorized: true,
    calls,
    notice: null,
    setNotice: () => void calls.push('notice'),
    markUnauthorized: () => void calls.push('mark'),
    clearUnauthorized: () => void calls.push('clearUnauthorized'),
    setState: (next: AuthState) => {
      calls.push('setState');
      store.state = next;
    },
  };
  return store;
}

describe('applyAuthState', () => {
  it('drops the cache and the 401 flag when the person changes', () => {
    const clear = jest.fn();
    const store = fakeStore(a);
    applyAuthState(b, clear, store);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(store.calls).toEqual(['clearUnauthorized', 'setState']);
    expect(store.state).toBe(b);
  });

  it('drops the cache on sign-out, so the next person never sees it', () => {
    const clear = jest.fn();
    applyAuthState(out, clear, fakeStore(a));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('drops what was fetched while loading once the person is known', () => {
    // Requests that went out before Firebase answered carried no token.
    const clear = jest.fn();
    applyAuthState(a, clear, fakeStore(loading));
    expect(clear).toHaveBeenCalledTimes(1);
    // Loading then signed out: the anonymous answers are what signed-out sees.
    const none = jest.fn();
    applyAuthState(out, none, fakeStore(loading));
    expect(none).not.toHaveBeenCalled();
  });

  it('leaves the cache alone when nothing changed', () => {
    const clear = jest.fn();
    const store = fakeStore(a);
    applyAuthState({...a}, clear, store);
    applyAuthState(loading, clear, store);
    expect(clear).not.toHaveBeenCalled();
    expect(store.calls).not.toContain('clearUnauthorized');
  });
});

describe('sign-in results', () => {
  it('falls back to a redirect for a blocked popup and nothing else', () => {
    expect(popupFallsBackToRedirect('auth/popup-blocked')).toBe(true);
    expect(
      popupFallsBackToRedirect(
        'auth/operation-not-supported-in-this-environment',
      ),
    ).toBe(true);
    expect(popupFallsBackToRedirect('auth/popup-closed-by-user')).toBe(false);
    expect(popupFallsBackToRedirect('auth/network-request-failed')).toBe(false);
  });

  it('shows a line only for a failure or an unavailable build', () => {
    expect(signInMessage({kind: 'ok'})).toBeNull();
    expect(signInMessage({kind: 'cancelled'})).toBeNull();
    expect(signInMessage({kind: 'redirecting'})).toBeNull();
    expect(signInMessage({kind: 'unavailable', message: 'Not yet.'})).toBe(
      'Not yet.',
    );
    expect(signInMessage({kind: 'failed', message: 'network'})).toBe(
      'Sign-in failed: network',
    );
  });
});

describe('tokenSource', () => {
  afterEach(() => {
    setIdTokenProvider(null);
    setUnauthorizedListener(null);
  });

  it('builds a Bearer header, or none', () => {
    expect(bearer('tok')).toEqual({Authorization: 'Bearer tok'});
    expect(bearer(null)).toEqual({});
  });

  it('sends the current token, fetched per call', async () => {
    expect(await authHeaders()).toEqual({});
    let n = 0;
    setIdTokenProvider(async () => `tok-${++n}`);
    expect(await authHeaders()).toEqual({Authorization: 'Bearer tok-1'});
    expect(await authHeaders()).toEqual({Authorization: 'Bearer tok-2'});
    setIdTokenProvider(null);
    expect(await authHeaders()).toEqual({});
  });

  it('a request started before Firebase answers carries the restored token', async () => {
    beginAuthWait();
    const early = authHeaders(); // the app's first query, before the user is known
    let settled = false;
    void early.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    // The session sets the provider first, then opens the gate.
    setIdTokenProvider(async () => 'restored');
    endAuthWait();
    expect(await early).toEqual({Authorization: 'Bearer restored'});
  });

  it('a request started before Firebase answers goes out signed-out when there is no user', async () => {
    beginAuthWait();
    const early = authHeaders();
    endAuthWait();
    expect(await early).toEqual({});
  });

  it('does not wait once Firebase has answered, and beginAuthWait is idempotent', async () => {
    beginAuthWait();
    beginAuthWait();
    endAuthWait();
    setIdTokenProvider(async () => 'tok');
    expect(await authHeaders()).toEqual({Authorization: 'Bearer tok'});
  });

  it('stops waiting for a stuck SDK after a while', async () => {
    jest.useFakeTimers();
    try {
      beginAuthWait();
      const stuck = authHeaders();
      await jest.advanceTimersByTimeAsync(10_001);
      expect(await stuck).toEqual({});
    } finally {
      endAuthWait();
      jest.useRealTimers();
    }
  });

  it('sends no header, rather than throwing, when the refresh fails', async () => {
    setIdTokenProvider(async () => {
      throw new Error('offline');
    });
    expect(await authHeaders()).toEqual({});
  });

  it('reports a 401 to whoever listens, and to nobody otherwise', () => {
    expect(() => reportUnauthorized()).not.toThrow();
    const listener = jest.fn();
    setUnauthorizedListener(listener);
    reportUnauthorized();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
