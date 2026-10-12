import {afterEach, describe, expect, it, jest} from '@jest/globals';
import {type Auth} from 'firebase/auth';

import {authHeaders, beginAuthWait, endAuthWait} from '../data/tokenSource';

import {followFirebaseAuth} from './followFirebase';

type AuthListener = (
  user: {
    uid: string;
    email: string | null;
    getIdToken: () => Promise<string>;
  } | null,
) => void;

let listener: AuthListener | null = null;

jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, next: AuthListener) => {
    listener = next;
    return () => {
      listener = null;
    };
  },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('@/src/utils/queryClient', () => ({queryClient: {clear: () => {}}}));
jest.mock('../data/queryPersist', () => ({
  forgetQueryPersist: async () => {},
  loadSnapshot: async () => null,
  startQueryPersist: () => () => {},
}));

const user = {uid: 'u', email: null, getIdToken: async () => 'tok'};

describe('followFirebaseAuth', () => {
  afterEach(() => {
    endAuthWait();
  });

  it('a request made while the session restarts waits for the new answer and carries the token', async () => {
    beginAuthWait();
    const stop = followFirebaseAuth({} as Auth);
    await listener?.(user);
    expect(await authHeaders()).toEqual({Authorization: 'Bearer tok'});

    // The tree unmounts and mounts again (a root remount): the first request of
    // the new tree comes before the new session's first answer.
    stop();
    const early = authHeaders();
    let settled = false;
    void early.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    const again = followFirebaseAuth({} as Auth);
    await listener?.(user);
    expect(await early).toEqual({Authorization: 'Bearer tok'});
    again();
  });
});
