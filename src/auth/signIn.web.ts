import {
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
} from 'firebase/auth';

import {firebaseAuth} from './firebase';
import {type SignInResult, popupFallsBackToRedirect} from './signInResult';

export async function signIn(): Promise<SignInResult> {
  const auth = firebaseAuth();
  const provider = new GoogleAuthProvider();
  // Always show Google's account chooser. Without it a browser that is signed
  // in to one Google account signs in as that one with no choice, which is
  // wrong for anyone with several (and for signing in as someone else).
  provider.setCustomParameters({prompt: 'select_account'});
  try {
    await signInWithPopup(auth, provider);
    return {kind: 'ok'};
  } catch (error) {
    const code = (error as {code?: string}).code ?? '';
    // The person closed the window: nothing went wrong.
    if (
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request'
    )
      return {kind: 'cancelled'};
    // Popups are often blocked on phones; a full-page redirect works there and
    // comes back through finishRedirect() on the next load.
    if (popupFallsBackToRedirect(code)) {
      await signInWithRedirect(auth, provider);
      return {kind: 'redirecting'};
    }
    return {kind: 'failed', message: (error as Error).message};
  }
}

/** Completes a redirect sign-in; resolves quietly when there is none. */
export async function finishRedirect(): Promise<SignInResult | null> {
  try {
    const result = await getRedirectResult(firebaseAuth());
    return result ? {kind: 'ok'} : null;
  } catch (error) {
    return {kind: 'failed', message: (error as Error).message};
  }
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(firebaseAuth());
}
