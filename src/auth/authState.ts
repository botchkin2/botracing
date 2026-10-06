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
 * What the data layer's 401 means for the screen: with no one signed in it is
 * "sign in"; with someone signed in the token was refused, which is
 * "sign in again", not "no data".
 */
export function unauthorizedPrompt(state: AuthState): string {
  return state.kind === 'signed-in'
    ? 'Your sign-in was not accepted. Sign in again to see your sessions.'
    : 'Sign in to see your sessions.';
}
