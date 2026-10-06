// The outcome of a sign-in attempt, and which Firebase errors mean "try the
// full-page redirect instead". Pure, so the rules are tested without the SDK.

export type SignInResult =
  | {kind: 'ok'}
  | {kind: 'cancelled'}
  | {kind: 'redirecting'}
  | {kind: 'unavailable'; message: string}
  | {kind: 'failed'; message: string};

// A blocked popup, or an environment that cannot open one (an embedded
// webview, some in-app browsers).
const REDIRECT_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
]);

export const popupFallsBackToRedirect = (code: string): boolean =>
  REDIRECT_CODES.has(code);

/** One plain line for the screen; null when there is nothing to say. */
export function signInMessage(result: SignInResult): string | null {
  switch (result.kind) {
    case 'ok':
    case 'cancelled':
    case 'redirecting':
      return null;
    case 'unavailable':
      return result.message;
    case 'failed':
      return `Sign-in failed: ${result.message}`;
  }
}
