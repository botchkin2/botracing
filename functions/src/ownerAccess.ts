// Who is asking, and which stored files they may be handed. No Firebase
// imports, so node --test runs it (functions/test/ownerAccess.test.mjs);
// lmuApi.ts binds it to Admin Auth and Firestore.

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$/;

export class Unauthorized extends Error {}

export interface OwnerDeps {
  verifyToken(idToken: string): Promise<{uid: string}>;
  // users/{uid}.ownerKey, or null when there is no mapping.
  readOwnerKey(uid: string): Promise<string | null>;
}

// The owner key for a request. No token, or a bad or expired one, is
// Unauthorized. Same mapping rule as the upload endpoint (uploadCore.ts):
// the admin-set key, else the uid.
export async function resolveOwner(
  deps: OwnerDeps,
  authorization: string | undefined,
): Promise<string> {
  if (!authorization) throw new Unauthorized('sign in');
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

/**
 * The uploader status docs a person may see: only their own (the tray writes
 * them through the upload endpoint with the owner stamped from its token), and
 * without the server's bookkeeping. A doc with no ownerId (the old
 * Admin-written ones) is shown to nobody: it ages out.
 */
export function uploaderItems(
  owner: string,
  docs: {id: string; data: Record<string, unknown>}[],
): Record<string, unknown>[] {
  return docs
    .filter(({data}) => data.ownerId === owner)
    .map(({id, data}) => {
      const {ownerId: _owner, serverUpdatedAt: _stamp, ...visible} = data;
      return {...visible, hostId: data.hostId ?? id};
    });
}

// Track docs are app data, written only by the admin tools (the upload
// endpoint refuses every track write), so the files they name are served to
// every signed-in owner. Defence in depth: only the two folders the tools write
// (surface/{trackId}/v1.json.gz, trackmaps/{trackId}/v1.geojson.gz), exactly
// folder/trackId/file, every segment passing the segment rule, so a bad track
// doc still cannot name another owner's file or climb out.
const TRACK_FOLDERS = ['surface', 'trackmaps'];

export function trustedTrackPath(path: unknown): string | null {
  if (typeof path !== 'string') return null;
  const segments = path.split('/');
  if (segments.length !== 3) return null;
  for (const segment of segments)
    if (!SAFE_SEGMENT.test(segment) || segment.includes('..')) return null;
  return TRACK_FOLDERS.includes(segments[0]) ? path : null;
}
