import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
} from '@react-native-google-signin/google-signin';
import {
  GoogleAuthProvider,
  signInWithCredential,
  signOut as firebaseSignOut,
} from 'firebase/auth';

import {firebaseAuth} from './firebase';
import {GOOGLE_WEB_CLIENT_ID} from './googleClient';
import {type SignInResult, nativeSignInFailure} from './signInResult';

// The library's free version uses Google's legacy Sign-In SDK on Android, which
// Google has deprecated: moving off it before a public release is issue #298.
//
// The Android sign-in: the Google account picker, which gives a Google ID
// token, which Firebase Auth turns into the signed-in user (the same user the
// web build and the tray sign in as, so the same sessions).

let configured = false;
function configure(): void {
  if (configured) return;
  GoogleSignin.configure({webClientId: GOOGLE_WEB_CLIENT_ID});
  configured = true;
}

export async function signIn(): Promise<SignInResult> {
  if (!GOOGLE_WEB_CLIENT_ID)
    return {
      kind: 'unavailable',
      message:
        'This build has no Google client id set (src/auth/googleClient.ts), so it cannot sign in.',
    };
  try {
    configure();
    await GoogleSignin.hasPlayServices({showPlayServicesUpdateDialog: true});
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return {kind: 'cancelled'};
    const idToken = response.data.idToken;
    if (!idToken)
      return {kind: 'failed', message: 'Google did not return an ID token.'};
    await signInWithCredential(
      firebaseAuth(),
      GoogleAuthProvider.credential(idToken),
    );
    return {kind: 'ok'};
  } catch (error) {
    const code = isErrorWithCode(error) ? String(error.code) : '';
    return nativeSignInFailure(code, (error as Error).message);
  }
}

/** Nothing to finish on Android: there is no redirect. */
export async function finishRedirect(): Promise<SignInResult | null> {
  return null;
}

export async function signOut(): Promise<void> {
  // Sign out of Google too, or the account picker would skip the choice and
  // silently pick the same account again.
  try {
    configure();
    await GoogleSignin.signOut();
  } catch {
    // Not signed in to Google (or not configured): Firebase is what matters.
  }
  await firebaseSignOut(firebaseAuth());
}
