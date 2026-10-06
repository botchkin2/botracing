// The one place the data layer learns who is signed in, with no Firebase or
// React in it so tests (and `src/data`) can use it. The auth session
// (useAuthSession.ts) registers a provider once Firebase has a user.

type IdTokenProvider = () => Promise<string | null>;

let provider: IdTokenProvider | null = null;
let onUnauthorized: (() => void) | null = null;

export function setIdTokenProvider(next: IdTokenProvider | null): void {
  provider = next;
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
 * The Authorization header for the API: the current ID token (the SDK
 * refreshes it before it expires), or nothing when signed out. A failed
 * refresh sends no header rather than throwing, so the API answers 401 and the
 * sign-in prompt shows, instead of the screen showing a network error.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  if (!provider) return {};
  try {
    return bearer(await provider());
  } catch {
    return {};
  }
}
