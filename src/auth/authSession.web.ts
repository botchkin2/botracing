import {onAuthStateChanged} from 'firebase/auth';

import {queryClient} from '@/src/utils/queryClient';

import {type AuthState} from './authState';
import {applyAuthState, useAuthStore} from './authStore';
import {firebaseAuth} from './firebase';
import {finishRedirect} from './signIn.web';
import {setIdTokenProvider, setUnauthorizedListener} from '../data/tokenSource';

/**
 * Starts following the Firebase sign-in (web). Called once from the root
 * layout's effect; returns the stop function. Until the SDK has read its
 * stored sign-in the state is 'loading'.
 */
export function startAuthSession(): () => void {
  const auth = firebaseAuth();
  setUnauthorizedListener(() => useAuthStore.getState().markUnauthorized());
  // A redirect sign-in ends on a fresh page load; onAuthStateChanged below
  // reports the user it produced, this only surfaces a failure to the log.
  void finishRedirect();
  const stop = onAuthStateChanged(auth, user => {
    const next: AuthState = user
      ? {kind: 'signed-in', uid: user.uid, email: user.email}
      : {kind: 'signed-out'};
    setIdTokenProvider(user ? () => user.getIdToken() : null);
    applyAuthState(next, () => queryClient.clear());
  });
  return () => {
    stop();
    setIdTokenProvider(null);
    setUnauthorizedListener(null);
  };
}
