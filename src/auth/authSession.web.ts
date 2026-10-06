import {onAuthStateChanged} from 'firebase/auth';

import {queryClient} from '@/src/utils/queryClient';

import {type AuthState} from './authState';
import {applyAuthState, useAuthStore} from './authStore';
import {firebaseAuth} from './firebase';
import {signInMessage} from './signInResult';
import {finishRedirect} from './signIn.web';
import {
  beginAuthWait,
  endAuthWait,
  setIdTokenProvider,
  setUnauthorizedListener,
} from '../data/tokenSource';

// Child effects run before the root layout's, so the first queries can fire
// before startAuthSession does: the wait opens when this module loads, which is
// before anything renders. (Not in Node: the web export renders there.)
if (typeof window !== 'undefined') beginAuthWait();

/** The web build signs in: signed out, it shows the login screen. */
export const signInRequired = true;

/**
 * Starts following the Firebase sign-in (web). Called once from the root
 * layout's effect; returns the stop function. Until the SDK has read its
 * stored sign-in the state is 'loading'.
 */
export function startAuthSession(): () => void {
  // Requests wait for Firebase's first answer: see data/tokenSource.ts.
  beginAuthWait();
  const auth = firebaseAuth();
  setUnauthorizedListener(() => useAuthStore.getState().markUnauthorized());
  // A redirect sign-in ends on a fresh page load; onAuthStateChanged below
  // reports the user it produced, this only surfaces a failure to the person.
  void finishRedirect().then(result => {
    const message = result ? signInMessage(result) : null;
    if (message) useAuthStore.getState().setNotice(message);
  });
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
