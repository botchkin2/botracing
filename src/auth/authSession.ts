import {Linking} from 'react-native';
import {signInWithCustomToken} from 'firebase/auth';

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
  const stop = followFirebaseAuth(firebaseAuth());
  // DEV_SEAT_SIGNIN: the debug build on an emulator signs in as seat-test from a deep link (devSeatLink.ts); never in a release.
  // (EXPO_PUBLIC_SEAT_LINK=1 is the same for an emulator build that bundles its JS, a release variant; unset in every real build.)
  if (__DEV__ || process.env.EXPO_PUBLIC_SEAT_LINK === '1') {
    const {signInFromSeatLink} = require('./devSeatLink') as typeof import('./devSeatLink');
    const auth = firebaseAuth();
    const run = (url: string | null) =>
      void signInFromSeatLink(url, {
        signIn: async token => (await signInWithCustomToken(auth, token)).user,
        signOut: () => auth.signOut(),
      });
    void Linking.getInitialURL().then(run);
    const sub = Linking.addEventListener('url', e => run(e.url));
    return () => {
      sub.remove();
      stop();
    };
  }
  return stop;
}
