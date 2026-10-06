import {type SignInResult} from './signInResult';

// The Android app's sign-in (the system Google account picker) is its own
// change: it needs a native module and a new APK build. Until then the app
// says so rather than failing. The web build uses signIn.web.ts.

export async function signIn(): Promise<SignInResult> {
  return {
    kind: 'unavailable',
    message: 'Sign-in is not available in this app build yet.',
  };
}

export async function finishRedirect(): Promise<SignInResult | null> {
  return null;
}

export async function signOut(): Promise<void> {}
