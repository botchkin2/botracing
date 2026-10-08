import {beginAuthWait} from '../data/tokenSource';

import {firebaseAuth} from './firebase';
import {followFirebaseAuth} from './followFirebase';

// Requests wait for Firebase's first answer (data/tokenSource.ts). Opened when
// this module loads, before anything renders, because child effects run before
// the root layout's.
beginAuthWait();

/** The Android app signs in (signIn.ts): signed out, it shows the login screen. */
export const signInRequired = true;

/** Starts following the Firebase sign-in, restored from storage on launch. */
export function startAuthSession(): () => void {
  beginAuthWait();
  return followFirebaseAuth(firebaseAuth());
}
