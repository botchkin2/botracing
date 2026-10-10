import AsyncStorage from '@react-native-async-storage/async-storage';
import {type Auth, onAuthStateChanged} from 'firebase/auth';

import {queryClient} from '@/src/utils/queryClient';

import {forgetQueryPersist, startQueryPersist} from '../data/queryPersist';
import {
  endAuthWait,
  setIdTokenProvider,
  setUnauthorizedListener,
} from '../data/tokenSource';

import {type AuthState} from './authState';
import {applyAuthState, useAuthStore} from './authStore';

/**
 * Keeps the app in step with a Firebase Auth instance, the same on the web and
 * on Android: every answer sets the token provider first, then the state (the
 * cache is cleared when the person changed), then opens the gate that holds
 * API requests until Firebase has answered once. Returns the stop function.
 */
export function followFirebaseAuth(auth: Auth): () => void {
  setUnauthorizedListener(() => useAuthStore.getState().markUnauthorized());
  // The kept map, surface and Plan (data/queryPersist.ts) belong to one person:
  // restored and kept for them, dropped on sign-out or when someone else signs in.
  let persistFor: string | null = null;
  let stopPersist: (() => void) | null = null;
  const followPersist = (uid: string | null) => {
    if (uid === persistFor) return;
    stopPersist?.();
    stopPersist = null;
    if (persistFor !== null || uid === null) void forgetQueryPersist(AsyncStorage);
    persistFor = uid;
    if (uid)
      void startQueryPersist(queryClient, AsyncStorage, uid).then(stopIt => {
        if (persistFor === uid) stopPersist = stopIt;
        else stopIt();
      });
  };
  const stop = onAuthStateChanged(auth, user => {
    const next: AuthState = user
      ? {kind: 'signed-in', uid: user.uid, email: user.email}
      : {kind: 'signed-out'};
    setIdTokenProvider(user ? () => user.getIdToken() : null);
    applyAuthState(next, () => queryClient.clear());
    followPersist(user?.uid ?? null);
    // After the provider is set, so a waiting request carries the token.
    endAuthWait();
  });
  return () => {
    stop();
    stopPersist?.();
    setIdTokenProvider(null);
    setUnauthorizedListener(null);
    endAuthWait();
  };
}
