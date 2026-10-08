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

/**
 * What an error from the Android Google sign-in means, in a line a person can
 * act on that still quotes the cause. The codes are Google Play services'
 * (the library passes them through as strings): 12501 the person backed out,
 * 7 network, 10 the app is not registered with Google (the developer error:
 * wrong package or signing key in the Google Cloud console), 12500 a generic
 * failure. An unknown code is shown as it came.
 */
export function nativeSignInFailure(
  code: string,
  message: string,
): SignInResult {
  switch (code) {
    case '12501':
    case 'SIGN_IN_CANCELLED':
      return {kind: 'cancelled'};
    case 'ASYNC_OP_IN_PROGRESS':
    case 'IN_PROGRESS':
      return {kind: 'cancelled'};
    case '7':
      return {
        kind: 'failed',
        message: 'No connection to Google. Check the network and try again.',
      };
    case '10':
      return {
        kind: 'failed',
        message:
          'Google does not know this build of the app (DEVELOPER_ERROR 10): its package and signing key must be registered in the Google Cloud console.',
      };
    case 'PLAY_SERVICES_NOT_AVAILABLE':
      return {
        kind: 'failed',
        message:
          'Google Play services is missing or out of date on this phone.',
      };
    default:
      return {
        kind: 'failed',
        message: code ? `${message} (code ${code})` : message,
      };
  }
}
