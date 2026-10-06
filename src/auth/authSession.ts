import {applyAuthState, useAuthStore} from './authStore';
import {setIdTokenProvider, setUnauthorizedListener} from '../data/tokenSource';

/** This build cannot sign in yet, so it never shows the login screen. */
export const signInRequired = false;

/**
 * The Android app has no sign-in yet (signIn.ts): it is signed out, and a 401
 * from the API shows the prompt that says so. The web build follows Firebase
 * in authSession.web.ts.
 */
export function startAuthSession(): () => void {
  setIdTokenProvider(null);
  setUnauthorizedListener(() => useAuthStore.getState().markUnauthorized());
  applyAuthState({kind: 'signed-out'}, () => {});
  return () => setUnauthorizedListener(null);
}
