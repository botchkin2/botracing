// What the app knows about the person: pure, no Firebase, so the screens and
// their tests do not need the SDK.

export type AuthState =
  | {kind: 'loading'}
  | {kind: 'signed-out'}
  | {kind: 'signed-in'; uid: string; email: string | null};

/** The label the Account row shows. */
export function accountLabel(state: AuthState): string {
  if (state.kind === 'loading') return 'Checking sign-in…';
  if (state.kind === 'signed-out') return 'Not signed in';
  return state.email ?? 'Signed in';
}

/**
 * The cached server data belongs to one person. When the signed-in user
 * changes (sign in, sign out, switch account) the cache must be dropped, or
 * the next screen could show the previous person's sessions. `loading` is not
 * a change: it is the SDK still reading its stored sign-in.
 */
export function userChanged(before: AuthState, after: AuthState): boolean {
  if (after.kind === 'loading') return false;
  const id = (state: AuthState) =>
    state.kind === 'signed-in' ? state.uid : null;
  if (before.kind === 'loading') return id(after) !== null;
  return id(before) !== id(after);
}

/**
 * What the app shows for the sign-in state, in one place so it can be tested:
 *   blank     the SDK is still reading the stored sign-in (never the login
 *             screen: a signed-in person must not see it flash on every load)
 *   login     nobody is signed in and this build can sign in: the login screen
 *             replaces the app, so nothing is fetched or shown for a stranger
 *   app       the app (with the sign-in prompt over it on a 401, see below)
 * `signInRequired` is false in a build that cannot sign in yet (the Android
 * app), which keeps showing the app.
 */
export type GateView = 'blank' | 'login' | 'app';

export function gateView(state: AuthState, signInRequired: boolean): GateView {
  if (!signInRequired) return 'app';
  if (state.kind === 'loading') return 'blank';
  return state.kind === 'signed-out' ? 'login' : 'app';
}

/**
 * What the data layer's 401 means for the screen: with no one signed in it is
 * "sign in"; with someone signed in the token was refused, which is
 * "sign in again", not "no data".
 */
export function unauthorizedPrompt(
  state: AuthState,
  canSignIn: boolean,
): string {
  if (!canSignIn)
    return 'This version of the app cannot sign in yet, so it cannot open your sessions. An update that adds sign-in is coming.';
  return state.kind === 'signed-in'
    ? 'Your sign-in was not accepted. Sign in again to see your sessions.'
    : 'Sign in to see your sessions.';
}
