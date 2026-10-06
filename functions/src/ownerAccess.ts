// Who is asking, and which stored files they may be handed. No Firebase
// imports, so node --test runs it (functions/test/ownerAccess.test.mjs);
// lmuApi.ts binds it to Admin Auth and Firestore.

export const LEGACY_OWNER = 'botkin';
// A request with no Authorization header is read as the legacy owner, as it
// always was, so the app keeps working for Botkin until he signs in on the
// web app. Set to null to require sign-in (the next step after he has).
export const ANONYMOUS_OWNER: string | null = LEGACY_OWNER;

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$/;

export class Unauthorized extends Error {}

export interface OwnerDeps {
  verifyToken(idToken: string): Promise<{uid: string}>;
  // users/{uid}.ownerKey, or null when there is no mapping.
  readOwnerKey(uid: string): Promise<string | null>;
}

// The owner key for a request. A bad or expired token is Unauthorized and
// never falls back to the anonymous owner. Same mapping rule as the upload
// endpoint (uploadCore.ts): the admin-set key, else the uid.
export async function resolveOwner(
  deps: OwnerDeps,
  authorization: string | undefined,
  anonymousOwner: string | null = ANONYMOUS_OWNER,
): Promise<string> {
  if (!authorization) {
    if (anonymousOwner) return anonymousOwner;
    throw new Unauthorized('sign in');
  }
  const token = authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : '';
  if (!token) throw new Unauthorized('bad authorization header');
  let uid = '';
  try {
    ({uid} = await deps.verifyToken(token));
  } catch {
    throw new Unauthorized('bad token');
  }
  if (!uid) throw new Unauthorized('bad token');
  const mapped = await deps.readOwnerKey(uid);
  const owner = mapped && SAFE_KEY.test(mapped) ? mapped : uid;
  if (!SAFE_KEY.test(owner)) throw new Unauthorized('bad token');
  return owner;
}

// The bucket folders a document may point at, per kind (docs/STORAGE.md).
// Session docs are written by their owner through the upload endpoint with
// whatever fields the client sends, so a doc's path is not trusted: it is only
// followed when it sits under the owner's own folder.
export type FileKind = 'band' | 'field' | 'slices';
const FOLDER: Record<FileKind, string> = {
  band: 'bands',
  field: 'field',
  slices: 'slices',
};

// Same segment rule as the upload endpoint (uploadCore.ts SAFE_SEGMENT).
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$/;

// The path when it is `{folder}/{owner}/{rest}` and every segment is safe, else
// null. The segments are checked first, so a `..`, an empty or dot-leading
// segment or a backslash can never be hidden behind a matching prefix.
export function pathInsideOwner(
  kind: FileKind,
  owner: string,
  path: unknown,
): string | null {
  if (typeof path !== 'string') return null;
  const segments = path.split('/');
  if (segments.length < 3) return null;
  for (const segment of segments)
    if (!SAFE_SEGMENT.test(segment) || segment.includes('..')) return null;
  return segments[0] === FOLDER[kind] && segments[1] === owner ? path : null;
}

// Track docs: the legacy owner's are shared and written by tools on this PC,
// so their paths stand. Anyone else's track doc is user-written, and the
// surface and outline folders are not per-owner yet: those paths are ignored.
export function trustedTrackPath(owner: string, path: unknown): string | null {
  return owner === LEGACY_OWNER && typeof path === 'string' ? path : null;
}
