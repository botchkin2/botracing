// The tray's sign-in through the web app (POST /api/tray/code, /api/tray/token),
// pit-wall thread 54. The tray has no Google OAuth client of its own: the
// person signs in on the site, as they always do, and the site hands the tray a
// ONE-TIME CODE that is useless without a secret only the tray holds.
//
//   tray      makes a verifier (32 random bytes), sends challenge = sha256(verifier)
//   site      POST /code {challenge}, signed in -> {code}; the browser carries the
//             code to the tray's loopback port
//   tray      POST /token {code, verifier} -> {customToken}, in the response body
//
// The code is single use and lives 120 s, and `token` needs the verifier, so a
// code read from browser history, an extension or a log signs nobody in. The
// custom token never appears in a URL.
//
// POST /api/tray/viewer is the tray's own window (pit-wall thread 55): the tray
// shows the hosted app in a window and signs it in as the tray's user, with no
// Google in the webview. The tray asks with its own ID token and gets a custom
// token for THAT user back in the response body (never a URL); the window
// takes it over IPC. Rules here; Firestore and Admin Auth are
// bound in trayApi.ts (plain TypeScript with erasable syntax only: Node runs it
// as is for the tests).
import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';

export const CODE_TTL_MS = 120_000;
/** How many codes one user may ask for per hour. */
export const CODES_PER_HOUR = 10;
export const HOUR_MS = 3_600_000;

/** What is stored for a code, under the code's hash (never the code itself). */
export interface CodeRecord {
  uid: string;
  /** From the ID token the code was asked with, so no Auth lookup is needed later. */
  email: string | null;
  challenge: string;
  expiresAtMs: number;
}

export interface TrayDeps {
  verifyToken(idToken: string): Promise<{uid: string; email: string | null}>;
  /** Stores a code's record under its hash. */
  put(codeHash: string, record: CodeRecord): Promise<void>;
  /** Reads and deletes in one transaction: a code can be taken once. */
  take(codeHash: string): Promise<CodeRecord | null>;
  /** True when this user may have another code now; counts the ask. */
  allow(uid: string, nowMs: number): Promise<boolean>;
  /** A Firebase custom token for the user. */
  mint(uid: string): Promise<string>;
  now(): number;
  /** 32 random bytes, base64url. */
  newCode(): string;
}

export interface TrayRequest {
  method: string;
  /** The path after /api/tray, e.g. "/code". */
  path: string;
  authorization: string | undefined;
  json: unknown;
}

export interface TrayResponse {
  status: number;
  json: Record<string, unknown>;
}

const B64URL = /^[A-Za-z0-9_-]+$/;
// base64url of 32 bytes.
const CHALLENGE_LENGTH = 43;

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** base64url(sha256(verifier)): the challenge the tray sent for this verifier. */
export function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function randomCode(): string {
  return randomBytes(32).toString('base64url');
}

function fail(status: number, error: string): TrayResponse {
  return {status, json: {error}};
}

function field(json: unknown, name: string): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const value = (json as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : null;
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// One answer for every reason a code cannot be used, so nothing says which.
const REFUSED = 'sign in again';

export async function handleTray(
  deps: TrayDeps,
  req: TrayRequest,
): Promise<TrayResponse> {
  if (req.method !== 'POST') return fail(405, 'POST only');

  if (req.path === '/code') {
    const header = req.authorization ?? '';
    const idToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!idToken) return fail(401, 'sign in');
    let uid: string;
    let email: string | null;
    try {
      ({uid, email} = await deps.verifyToken(idToken));
    } catch {
      return fail(401, 'sign in');
    }
    const challenge = field(req.json, 'challenge');
    if (
      challenge === null ||
      challenge.length !== CHALLENGE_LENGTH ||
      !B64URL.test(challenge)
    )
      return fail(400, 'bad challenge');
    const now = deps.now();
    if (!(await deps.allow(uid, now))) return fail(429, 'too many sign-ins');
    const code = deps.newCode();
    await deps.put(sha256Hex(code), {
      uid,
      email,
      challenge,
      expiresAtMs: now + CODE_TTL_MS,
    });
    return {status: 200, json: {code, expiresInS: CODE_TTL_MS / 1000}};
  }

  if (req.path === '/viewer') {
    const header = req.authorization ?? '';
    const idToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!idToken) return fail(401, 'sign in');
    let uid: string;
    let email: string | null;
    try {
      ({uid, email} = await deps.verifyToken(idToken));
    } catch {
      return fail(401, 'sign in');
    }
    // Its own count, apart from the sign-in codes: opening the window must not
    // use up the codes, nor the other way round. The user is the verified
    // token's, never anything in the body.
    if (!(await deps.allow(`viewer:${uid}`, deps.now())))
      return fail(429, 'too many sign-ins');
    return {
      status: 200,
      json: {customToken: await deps.mint(uid), uid, email},
    };
  }

  if (req.path === '/token') {
    const code = field(req.json, 'code');
    const verifier = field(req.json, 'verifier');
    if (
      code === null ||
      verifier === null ||
      code.length !== CHALLENGE_LENGTH ||
      !B64URL.test(code) ||
      verifier.length < 43 ||
      verifier.length > 128 ||
      !B64URL.test(verifier)
    )
      return fail(400, REFUSED);
    // Taking the record deletes it: a wrong verifier burns the code too, so a
    // guess cannot be tried twice.
    const record = await deps.take(sha256Hex(code));
    if (
      !record ||
      deps.now() > record.expiresAtMs ||
      !sameText(challengeOf(verifier), record.challenge)
    )
      return fail(400, REFUSED);
    const customToken = await deps.mint(record.uid);
    return {
      status: 200,
      json: {customToken, uid: record.uid, email: record.email},
    };
  }

  return fail(404, 'not found');
}
