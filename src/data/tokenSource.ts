// The one place the data layer learns who is signed in, with no Firebase or
// React in it so tests (and `src/data`) can use it. The auth session
// (src/auth/authSession) registers a provider once Firebase has a user.

type IdTokenProvider = () => Promise<string | null>;

let provider: IdTokenProvider | null = null;
let onUnauthorized: (() => void) | null = null;

export function setIdTokenProvider(next: IdTokenProvider | null): void {
  provider = next;
}

// While Firebase is still reading the stored sign-in, a request must wait: it
// would otherwise go out with no token, get the anonymous answer (a 401 once
// anonymous access is closed) and flash a sign-in prompt at someone who is
// signed in. The auth session opens the wait before the app's first request
// (beginAuthWait) and closes it on Firebase's first answer (endAuthWait),
// after the provider is set. With no auth session (tests, tools) there is no
// wait.
let waiting: Promise<void> | null = null;
let release: (() => void) | null = null;
// Firebase answers from local storage, so this is long; it only bounds a
// stuck SDK, after which the request goes out as signed out.
const AUTH_WAIT_MS = 10_000;

export function beginAuthWait(): void {
  if (waiting) return;
  waiting = new Promise<void>(resolve => {
    release = resolve;
  });
}

export function endAuthWait(): void {
  release?.();
  release = null;
  waiting = null;
}

async function authSettled(): Promise<void> {
  const pending = waiting;
  if (!pending) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>(resolve => {
    timer = setTimeout(resolve, AUTH_WAIT_MS);
  });
  await Promise.race([pending, timeout]);
  clearTimeout(timer);
}

/** Called by the data layer when the API answers 401. */
export function setUnauthorizedListener(next: (() => void) | null): void {
  onUnauthorized = next;
}

export function reportUnauthorized(): void {
  onUnauthorized?.();
}

export const bearer = (token: string | null): Record<string, string> =>
  token ? {Authorization: `Bearer ${token}`} : {};

/**
 * The ID token could not be had for someone who is signed in: the refresh of
 * an expired token failed, most often for want of signal. Not a 4xx, so React
 * Query retries it (retryUnlessClientError), and no request goes out bare: a
 * bare request's 401 would ask a signed-in person to sign in.
 */
export class AuthTokenError extends Error {
  constructor(readonly cause: unknown) {
    super('could not get the ID token');
    this.name = 'AuthTokenError';
  }
}

/**
 * The Authorization header for the API: the current ID token (the SDK
 * refreshes it before it expires), or nothing only when signed out. A failed
 * refresh throws AuthTokenError.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const started = waiting;
  await authSettled();
  // The root remounted after this call passed the gate (followFirebase's stop
  // nulls the provider and opens a new wait): wait for that answer, once, so a
  // stuck SDK still ends after AUTH_WAIT_MS rather than looping.
  if (!provider && waiting && waiting !== started) await authSettled();
  if (!provider) return {};
  let token: string | null;
  try {
    token = await provider();
  } catch (e) {
    throw new AuthTokenError(e);
  }
  return bearer(token);
}
