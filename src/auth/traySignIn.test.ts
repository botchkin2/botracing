import {describe, expect, it, jest} from '@jest/globals';

import {
  inTrayWindow,
  signInFromTray,
  toTrayToken,
  trayInvoke,
  traySignOut,
} from './traySignIn';

function deps(over: {
  user?: {uid: string} | null;
  answer?: unknown;
  signedInAs?: string;
  trayUid?: string | null;
}) {
  const auth = {
    currentUser: over.user ?? null,
    authStateReady: jest.fn(async () => {}),
    signOut: jest.fn(async () => {
      auth.currentUser = null;
    }),
  };
  const invoke = jest.fn(async (command: string) => {
    if (command === 'tray_uid')
      return over.trayUid === undefined ? 'u1' : over.trayUid;
    return over.answer === undefined
      ? {customToken: 'tok', uid: 'u1'}
      : over.answer;
  });
  const signIn = jest.fn(async (_token: string) => {
    auth.currentUser = {uid: over.signedInAs ?? 'u1'};
  });
  return {auth, invoke, signIn};
}

describe('trayInvoke', () => {
  it('is the window IPC only inside the tray window', () => {
    const invoke = () => Promise.resolve(null);
    expect(trayInvoke({__TAURI_INTERNALS__: {invoke}})).toBe(invoke);
    expect(trayInvoke({})).toBeNull();
    expect(trayInvoke({__TAURI_INTERNALS__: {}})).toBeNull();
    expect(trayInvoke({__TAURI_INTERNALS__: {invoke: 'x'}})).toBeNull();
    expect(trayInvoke(undefined)).toBeNull();
    // Node and a browser tab have no such window.
    expect(inTrayWindow()).toBe(false);
  });
});

describe('toTrayToken', () => {
  it('needs a token and a uid, both text', () => {
    expect(toTrayToken({customToken: 't', uid: 'u'})).toEqual({
      customToken: 't',
      uid: 'u',
    });
    for (const bad of [
      null,
      'x',
      {},
      {customToken: 't'},
      {uid: 'u'},
      {customToken: '', uid: 'u'},
      {customToken: 't', uid: 7},
    ])
      expect(toTrayToken(bad)).toBeNull();
  });
});

describe('signInFromTray', () => {
  it('signs a signed-out window in as the tray user', async () => {
    const d = deps({});
    expect(await signInFromTray(d)).toBe('signed-in');
    expect(d.invoke).toHaveBeenCalledWith('viewer_token');
    expect(d.signIn).toHaveBeenCalledWith('tok');
  });

  it('keeps a window already signed in as the tray user, spending no sign-in', async () => {
    const d = deps({user: {uid: 'u1'}});
    expect(await signInFromTray(d)).toBe('skipped');
    expect(d.invoke).toHaveBeenCalledTimes(1);
    expect(d.invoke).toHaveBeenCalledWith('tray_uid');
    expect(d.auth.signOut).not.toHaveBeenCalled();
    expect(d.signIn).not.toHaveBeenCalled();
  });

  it('replaces a sign-in kept from another user with the tray user', async () => {
    const d = deps({user: {uid: 'stale-user'}});
    expect(await signInFromTray(d)).toBe('signed-in');
    expect(d.auth.signOut).toHaveBeenCalledTimes(1);
    expect(d.signIn).toHaveBeenCalledWith('tok');
    expect(d.auth.currentUser).toEqual({uid: 'u1'});
  });

  it('signs the window out when the tray has no user', async () => {
    const d = deps({user: {uid: 'u1'}, trayUid: null});
    expect(await signInFromTray(d)).toBe('signed-out');
    expect(d.auth.signOut).toHaveBeenCalledTimes(1);
    expect(d.invoke).not.toHaveBeenCalledWith('viewer_token');
    expect(d.auth.currentUser).toBeNull();
  });

  it('asks for no sign-in when both the tray and the window are signed out', async () => {
    const d = deps({trayUid: null});
    expect(await signInFromTray(d)).toBe('skipped');
    expect(d.invoke).not.toHaveBeenCalledWith('viewer_token');
    expect(d.signIn).not.toHaveBeenCalled();
  });

  it('signs out again if the user it got is not the one the tray named', async () => {
    const d = deps({signedInAs: 'someone-else'});
    expect(await signInFromTray(d)).toBe('refused');
    expect(d.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('is a quiet failure when the tray says no, answers badly or the call throws', async () => {
    const refused = deps({});
    refused.invoke.mockImplementation(async (command: string) => {
      if (command === 'tray_uid') return 'u1';
      throw new Error('Sign in from the tray icon');
    });
    expect(await signInFromTray(refused)).toBe('failed');
    expect(refused.signIn).not.toHaveBeenCalled();
    const garbage = deps({answer: {nothing: true}});
    expect(await signInFromTray(garbage)).toBe('failed');
    expect(garbage.signIn).not.toHaveBeenCalled();
  });
});

describe('signInFromTray fails closed', () => {
  it('signs a kept sign-in out when the tray cannot say who it is', async () => {
    const d = deps({user: {uid: 'stale-user'}});
    d.invoke.mockRejectedValue(new Error('tray_uid not allowed'));
    expect(await signInFromTray(d)).toBe('failed');
    expect(d.auth.signOut).toHaveBeenCalledTimes(1);
    expect(d.auth.currentUser).toBeNull();
    expect(d.signIn).not.toHaveBeenCalled();
  });
});

describe('traySignOut', () => {
  it('is the tray command, so the tray signs out too', async () => {
    const invoke = jest.fn(async (_command: string) => null);
    await traySignOut(invoke);
    expect(invoke).toHaveBeenCalledWith('sign_out');
  });
});
