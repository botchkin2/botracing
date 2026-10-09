import {describe, expect, it, jest} from '@jest/globals';

import {customTokenUid, signInSeatTest} from './devSeatSignIn';

const tokenFor = (uid: string) =>
  `h.${btoa(JSON.stringify({uid})).replace(/=+$/, '')}.s`;

function deps(over: {
  user?: {uid: string} | null;
  hostname?: string;
  token?: string | null;
  signedInAs?: string;
}) {
  const auth = {
    currentUser: over.user ?? null,
    authStateReady: jest.fn(async () => {}),
    signOut: jest.fn(async () => {
      auth.currentUser = null;
    }),
  };
  const signIn = jest.fn(async () => {
    auth.currentUser = {uid: over.signedInAs ?? 'seat-test'};
  });
  const fetchToken = jest.fn(async () =>
    over.token === undefined ? tokenFor('seat-test') : over.token,
  );
  return {
    auth,
    signIn,
    fetchToken,
    hostname: over.hostname ?? 'localhost',
  };
}

describe('customTokenUid', () => {
  it('reads the uid claim, null for anything else', () => {
    expect(customTokenUid(tokenFor('seat-test'))).toBe('seat-test');
    expect(customTokenUid('nonsense')).toBeNull();
    expect(customTokenUid('a.@@@.c')).toBeNull();
  });
});

describe('signInSeatTest', () => {
  it('signs a signed-out localhost pane in as seat-test', async () => {
    const d = deps({});
    expect(await signInSeatTest(d)).toBe('signed-in');
    expect(d.signIn).toHaveBeenCalledTimes(1);
  });

  it('does nothing off this machine and never asks for a token', async () => {
    const d = deps({hostname: 'botracing-61.web.app'});
    expect(await signInSeatTest(d)).toBe('skipped');
    expect(d.fetchToken).not.toHaveBeenCalled();
  });

  it('leaves an existing sign-in alone', async () => {
    const d = deps({user: {uid: 'someone'}});
    expect(await signInSeatTest(d)).toBe('skipped');
    expect(d.fetchToken).not.toHaveBeenCalled();
  });

  it('refuses a token for any other uid before signing in', async () => {
    const d = deps({token: tokenFor('botkin-real-uid')});
    expect(await signInSeatTest(d)).toBe('refused');
    expect(d.signIn).not.toHaveBeenCalled();
  });

  it('signs out again if the user it got is not seat-test', async () => {
    const d = deps({signedInAs: 'other'});
    expect(await signInSeatTest(d)).toBe('refused');
    expect(d.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('is a quiet failure when there is no token or the call throws', async () => {
    expect(await signInSeatTest(deps({token: null}))).toBe('failed');
    const d = deps({});
    d.fetchToken.mockRejectedValueOnce(new Error('offline'));
    expect(await signInSeatTest(d)).toBe('failed');
  });
});
