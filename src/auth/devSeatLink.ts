// DEV_SEAT_SIGNIN. The debug build of the Android app (an emulator, never a release) signs in as seat-test from a deep
// link, `botracing61://dev-seat?ct=<custom token>`, so a seat can run the real app without Botkin's Google account
// (docs/TESTING.md). Loaded only under `if (__DEV__)` (authSession.ts), so a release bundle has none of it. Not a
// bypass: only the Admin service account can mint the token, and only for the seat-test uid, checked here too, and the
// signed-in user is read back and refused unless it is seat-test.

import {customTokenUid} from './devSeatSignIn';

const SEAT_UID = 'seat-test';
const LINK_HOST = 'dev-seat';
const LINK_PREFIX = `botracing61://${LINK_HOST}?`;

/** The custom token in a `botracing61://dev-seat?ct=...` link, or null for any other link. */
export function seatTokenFromUrl(url: string | null): string | null {
  // plain strings, not a regex: Hermes compiles a regex literal to bytecode, and CI looks for this text in an exported bundle
  if (!url || !url.startsWith(LINK_PREFIX)) return null;
  const token = new URLSearchParams(url.slice(LINK_PREFIX.length)).get('ct');
  return token && customTokenUid(token) === SEAT_UID ? token : null;
}

export type SeatLinkDeps = {
  signIn: (token: string) => Promise<{uid: string} | null>;
  signOut: () => Promise<void>;
};

/** Signs in with the link's token; signs back out if the person it made is not seat-test. */
export async function signInFromSeatLink(url: string | null, deps: SeatLinkDeps): Promise<'ignored' | 'signed-in' | 'refused' | 'failed'> {
  const token = seatTokenFromUrl(url);
  if (token === null) return 'ignored';
  try {
    const user = await deps.signIn(token);
    if (user?.uid !== SEAT_UID) {
      await deps.signOut();
      return 'refused';
    }
    return 'signed-in';
  } catch {
    return 'failed';
  }
}

export const SEAT_LINK_HOST = LINK_HOST;
