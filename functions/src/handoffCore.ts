// POST /api/auth/handoff: the app hands its signed-in person to the 3D page in its own WebView without asking again
// (pit-wall thread 94, gauge #6325). The app asks with its Firebase ID token and gets a custom token for THAT user back,
// in the response body; the page takes it from the address fragment and signs in. Nothing else comes back, and nothing
// in the request chooses the user: the uid is the verified token's, the body and the query are ignored.
// Rules here; Admin Auth and Firestore are bound in handoffApi.ts (plain TypeScript with erasable syntax only: Node
// runs it as is for the tests).

/** How many hand-offs one user may ask for per minute. */
export const HANDOFFS_PER_MINUTE = 10;
export const MINUTE_MS = 60_000;

export interface HandoffDeps {
  /** The verified ID token's user; throws for a missing, bad, expired or revoked token. */
  verifyToken(idToken: string): Promise<{uid: string}>;
  /** True when this user may have another hand-off now; counts the ask. */
  allow(uid: string, nowMs: number): Promise<boolean>;
  /** A Firebase custom token for the user. */
  mint(uid: string): Promise<string>;
  now(): number;
}

export interface HandoffRequest {
  method: string;
  authorization: string | undefined;
}

export interface HandoffResponse {
  status: number;
  json: Record<string, unknown>;
}

const fail = (status: number, error: string): HandoffResponse => ({status, json: {error}});

export async function handleHandoff(deps: HandoffDeps, req: HandoffRequest): Promise<HandoffResponse> {
  if (req.method !== 'POST') return fail(405, 'POST only');
  const header = req.authorization ?? '';
  const idToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!idToken) return fail(401, 'sign in');
  let uid: string;
  try {
    ({uid} = await deps.verifyToken(idToken));
  } catch {
    return fail(401, 'sign in');
  }
  if (!(await deps.allow(uid, deps.now()))) return fail(429, 'too many sign-ins');
  return {status: 200, json: {token: await deps.mint(uid)}};
}
