import {beginAuthWait} from '../data/tokenSource';

import {firebaseAuth} from './firebase';
import {followFirebaseAuth} from './followFirebase';
import {useAuthStore} from './authStore';
import {signInMessage} from './signInResult';
import {finishRedirect} from './signIn.web';

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
  // A redirect sign-in ends on a fresh page load; the auth listener reports the
  // user it produced, this only surfaces a failure to the person.
  void finishRedirect().then(result => {
    const message = result ? signInMessage(result) : null;
    if (message) useAuthStore.getState().setNotice(message);
  });
  return followFirebaseAuth(firebaseAuth());
}
