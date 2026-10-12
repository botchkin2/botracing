import {signInWithCustomToken} from 'firebase/auth';
import {Linking} from 'react-native';

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
// SCRATCH (tyre-native worktree only, never merged): sign in as seat-test from an
// adb deep link botracing61://seat?ct=<custom token>, for emulator measurements.
const seatLink = (url: string | null) => {
  const m = url?.match(/[?&]ct=([^&]+)/);
  if (m) void signInWithCustomToken(firebaseAuth(), decodeURIComponent(m[1]));
};

export function startAuthSession(): () => void {
  beginAuthWait();
  void Linking.getInitialURL().then(seatLink);
  Linking.addEventListener('url', e => seatLink(e.url));
  return followFirebaseAuth(firebaseAuth());
}
