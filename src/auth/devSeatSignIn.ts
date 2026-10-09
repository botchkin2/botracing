// DEV_SEAT_SIGNIN. A live slot (tools/dev/live.mjs) serves a seat-test custom
// token at /__seat-token; this signs the pane in with it, so a seat never needs
// a link. Loaded only under `if (__DEV__)` (authSession.web.ts), and CI fails
// if this marker or the path ever appears in an exported build
// (tools/ci/assertNoSeatSignIn.mjs). Not a bypass: only the Admin service
// account can mint the token, and only for the seat-test uid, checked here too.

const SEAT_UID = 'seat-test';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** The `user_id`/`uid` claim of a custom token, or null if it cannot be read. */
export function customTokenUid(token: string): string | null {
  try {
    const payload = token.split('.')[1] ?? '';
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as {uid?: unknown};
    return typeof claims.uid === 'string' ? claims.uid : null;
  } catch {
    return null;
  }
}

type SeatAuth = {
  authStateReady: () => Promise<void>;
  currentUser: {uid: string} | null;
  signOut: () => Promise<void>;
};

export type SeatSignInDeps = {
  auth: SeatAuth;
  hostname: string;
  fetchToken: () => Promise<string | null>;
  signIn: (token: string) => Promise<unknown>;
};

/**
 * Signs in as seat-test when the pane is signed out and the page is served
 * from this machine. Returns what happened; never throws.
 */
export async function signInSeatTest(
  deps: SeatSignInDeps,
): Promise<'skipped' | 'signed-in' | 'refused' | 'failed'> {
  const {auth, hostname, fetchToken, signIn} = deps;
  if (!LOCAL_HOSTS.has(hostname)) return 'skipped';
  try {
    await auth.authStateReady();
    if (auth.currentUser) return 'skipped';
    const token = await fetchToken();
    if (!token) return 'failed';
    if (customTokenUid(token) !== SEAT_UID) return 'refused';
    await signIn(token);
    // Read again: signIn changed it, which the compiler cannot see.
    const user = auth.currentUser as {uid: string} | null;
    if (user?.uid !== SEAT_UID) {
      await auth.signOut();
      return 'refused';
    }
    return 'signed-in';
  } catch {
    return 'failed';
  }
}

/** The token the live slot serves, or null when this is not a live slot. */
export async function fetchSlotToken(): Promise<string | null> {
  const res = await fetch('/__seat-token', {cache: 'no-store'});
  if (!res.ok) return null;
  const body = (await res.json()) as {token?: unknown};
  return typeof body.token === 'string' ? body.token : null;
}
