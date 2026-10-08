import {type Auth, onAuthStateChanged} from 'firebase/auth';

import {queryClient} from '@/src/utils/queryClient';

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
  const stop = onAuthStateChanged(auth, user => {
    const next: AuthState = user
      ? {kind: 'signed-in', uid: user.uid, email: user.email}
      : {kind: 'signed-out'};
    setIdTokenProvider(user ? () => user.getIdToken() : null);
    applyAuthState(next, () => queryClient.clear());
    // After the provider is set, so a waiting request carries the token.
    endAuthWait();
  });
  return () => {
    stop();
    setIdTokenProvider(null);
    setUnauthorizedListener(null);
    endAuthWait();
  };
}
