// The upload endpoint's rules, with no Firebase imports so node --test runs
// them (functions/test/uploadCore.test.mjs). uploadApi.ts binds them to
// Firestore, Storage and Auth.
//
// The PC uploader (tools/sessions/storeClient.mjs, pit wall thread 2 #15) runs
// the sync logic; this is a thin, validated store behind it. Trust rules from
// thread 2 (#8):
//   - The uid comes only from the verified ID token. Nothing in a request names
//     an owner. The owner key is the uid, or what an admin put in
//     users/{uid}.ownerKey (Botkin's is 'botkin', so his existing data keeps
//     its ids and paths). A client cannot write the users collection.
//   - Documents are stamped with the owner key; a document or file another
//     owner holds is refused, never overwritten.
//   - Paths come from allow-lists plus a safe id; size and shape are checked
//     here; usage is counted here from what was written.
//
// Layout (docs/STORAGE.md): recordings, sessions and laps are top-level and
// carry ownerId, as the readers expect. Track maps are per owner, so one
// user's track data cannot reach another's: the legacy owner keeps the shared
// tracks/ docs, everyone else gets users/{ownerKey}/tracks/. Bucket files are
// owner-scoped by their own path; archive/ has no owner segment, so non-legacy
// owners get archive/{ownerKey}/.
export const LEGACY_OWNER = 'botkin';
export const MAX_DOC_BYTES = 900_000; // Firestore's own limit is 1 MiB
// Files go straight to Storage by signed URL, not through the function; this
// bounds what a signed URL will accept.
export const MAX_FILE_BYTES = 200_000_000;
const UPLOAD_URL_MS = 15 * 60_000;
export const MAX_OPS = 400; // Firestore's batch limit is 500
const MAX_JSON_DEPTH = 20;

const OWNED = ['recordings', 'sessions', 'laps'];
const PER_OWNER = ['tracks', 'trackBoundaries'];
const WRITABLE = [...OWNED, ...PER_OWNER];
const READABLE = ['tracks', 'trackBoundaries', 'sessions'];
// update merges into an existing doc: only what the events pass sets.
const UPDATABLE = ['sessions', 'recordings'];
const UPDATE_FIELDS = new Set(['series', 'eventId', 'event']);
// Bucket folders (docs/STORAGE.md) and which carry the owner key as segment 2.
const OWNER_SCOPED = ['traces', 'bands', 'field', 'slices'];

const CONTENT_TYPE = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/;
// The sims tools/sessions writes under archive/{sim}/.
const SIMS = ['lmu', 'iracing'];
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$/;

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | {[key: string]: Json};
export type Doc = Record<string, Json>;

export type Write =
  | {op: 'set'; path: string; data: Doc; merge: boolean}
  | {op: 'update'; path: string; data: Doc}
  | {op: 'delete'; path: string};

export interface Usage {
  docs: number;
  docBytes: number;
  files: number;
  fileBytes: number;
}

export interface DocStore {
  get(path: string): Promise<Doc | null>;
  // Ids in `collectionPath` whose sessionId and ownerId equal these.
  lapIds(
    collectionPath: string,
    sessionId: string,
    ownerKey: string,
  ): Promise<string[]>;
  commit(writes: Write[]): Promise<void>;
  addUsage(uid: string, delta: Usage): Promise<void>;
}

export interface FileStore {
  stat(path: string): Promise<{md5Hash: string; size: number} | null>;
  // A short-lived URL that accepts one PUT to `path`, with exactly these
  // headers; Storage refuses a body over maxBytes (x-goog-content-length-range).
  signedUpload(
    path: string,
    options: {
      contentType: string;
      contentEncoding?: string;
      maxBytes: number;
      expiresMs: number;
    },
  ): Promise<{url: string; headers: Record<string, string>}>;
  read(path: string): Promise<Uint8Array | null>;
  remove(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export interface UploadDeps {
  verifyToken(idToken: string): Promise<{uid: string}>;
  docs: DocStore;
  files: FileStore;
}

export interface UploadRequest {
  method: string;
  path: string; // after /api/upload
  query: Record<string, string | undefined>;
  authorization: string | undefined;
  json?: unknown;
}

// 204 has no body; a file read has bytes; everything else has json.
export interface UploadResponse {
  status: number;
  json?: Json;
  bytes?: Uint8Array;
}

class Refused extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const refuse = (status: number, message: string): never => {
  throw new Refused(status, message);
};

// -- paths ------------------------------------------------------------------

function safeSegments(path: string, what: string): string[] {
  const segments = path.split('/');
  for (const s of segments)
    if (!SAFE_SEGMENT.test(s) || s.includes('..'))
      refuse(400, `${what}: bad path segment`);
  return segments;
}

function checkId(coll: unknown, id: unknown, allowed: string[]): void {
  if (typeof coll !== 'string' || !allowed.includes(coll))
    refuse(403, `collection not allowed: ${String(coll).slice(0, 40)}`);
  if (typeof id !== 'string' || !SAFE_SEGMENT.test(id) || id.includes('..'))
    refuse(400, 'bad document id');
}

const isLegacy = (ownerKey: string) => ownerKey === LEGACY_OWNER;

function docPath(ownerKey: string, coll: string, id: string): string {
  return PER_OWNER.includes(coll) && !isLegacy(ownerKey)
    ? `users/${ownerKey}/${coll}/${id}`
    : `${coll}/${id}`;
}

// The client's bucket path -> where it is stored, or a refusal.
function filePath(ownerKey: string, dest: unknown): string {
  if (typeof dest !== 'string') return refuse(400, 'dest must be a string');
  const segments = safeSegments(dest, 'file');
  if (segments.length < 3) return refuse(400, 'file path too short');
  const folder = segments[0];
  if (OWNER_SCOPED.includes(folder)) {
    if (segments[1] !== ownerKey)
      return refuse(403, 'file belongs to another owner');
    return dest;
  }
  if (folder === 'archive') {
    // The sim segment is allow-listed so the legacy owner's unscoped path
    // cannot name another owner's archive/{ownerKey}/ folder.
    if (!SIMS.includes(segments[1])) return refuse(403, 'unknown sim');
    return isLegacy(ownerKey)
      ? dest
      : `archive/${ownerKey}/${segments.slice(1).join('/')}`;
  }
  return refuse(403, 'file folder not allowed');
}

// A stored name back to the client's spelling (for /files).
function clientName(ownerKey: string, stored: string): string {
  const mine = `archive/${ownerKey}/`;
  return !isLegacy(ownerKey) && stored.startsWith(mine)
    ? `archive/${stored.slice(mine.length)}`
    : stored;
}

// -- documents --------------------------------------------------------------

// Plain JSON only, so nothing a Firestore client would treat specially
// (a reference, a sentinel) can arrive in a body.
function checkJson(value: unknown, depth = 0): void {
  if (depth > MAX_JSON_DEPTH) refuse(400, 'document too deeply nested');
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      refuse(400, 'document has a non-finite number');
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) checkJson(v, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as object)) {
      if (k === '' || k.includes('/') || k.startsWith('__'))
        refuse(400, `document has a bad field name: ${k.slice(0, 40)}`);
      checkJson(v, depth + 1);
    }
    return;
  }
  refuse(400, 'document has a value that is not JSON');
}

function cleanDoc(data: unknown): Doc {
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    return refuse(400, 'document data must be an object');
  checkJson(data);
  if (sizeOf(data) > MAX_DOC_BYTES) refuse(413, 'document too large');
  return {...(data as Doc)};
}

// Bytes, not characters: Firestore's limit is on bytes.
const sizeOf = (doc: unknown) => Buffer.byteLength(JSON.stringify(doc));

const isTheirs = (existing: Doc | null, ownerKey: string, coll: string) =>
  existing !== null && OWNED.includes(coll) && existing.ownerId !== ownerKey;

// An existing document of another owner is never touched.
function mustBeMine(
  existing: Doc | null,
  ownerKey: string,
  coll: string,
): void {
  if (isTheirs(existing, ownerKey, coll))
    refuse(403, 'document belongs to another owner');
}

async function writeDocs(
  uid: string,
  ownerKey: string,
  deps: UploadDeps,
  ops: unknown,
): Promise<void> {
  if (!Array.isArray(ops)) return refuse(400, 'ops must be a list');
  if (ops.length > MAX_OPS) return refuse(413, 'too many ops in one request');
  const writes: Write[] = [];
  const delta: Usage = {docs: 0, docBytes: 0, files: 0, fileBytes: 0};
  // Counted once per document, at the last write in this request.
  const seen = new Map<string, {before: number | null; after: number | null}>();
  for (const op of ops as Array<Record<string, unknown>>) {
    checkId(op?.coll, op?.id, WRITABLE);
    const coll = op.coll as string;
    const path = docPath(ownerKey, coll, op.id as string);
    const existing = await deps.docs.get(path);
    mustBeMine(existing, ownerKey, coll);
    const prior = seen.get(path);
    const before = prior ? prior.before : existing ? sizeOf(existing) : null;
    if (op.op === 'delete') {
      writes.push({op: 'delete', path});
      seen.set(path, {before, after: null});
      continue;
    }
    if (op.op !== 'set') return refuse(400, 'op must be set or delete');
    const data = cleanDoc(op.data);
    if (OWNED.includes(coll)) {
      if (data.ownerId !== ownerKey)
        return refuse(403, 'document ownerId is not yours');
    } else delete data.ownerId;
    writes.push({op: 'set', path, data, merge: op.merge === true});
    // A merge keeps fields it does not name, so the sent size under-counts it.
    seen.set(path, {before, after: sizeOf(data)});
  }
  for (const {before, after} of seen.values()) {
    delta.docs += (after === null ? 0 : 1) - (before === null ? 0 : 1);
    delta.docBytes += (after ?? 0) - (before ?? 0);
  }
  await deps.docs.commit(writes);
  await deps.docs.addUsage(uid, delta);
}

// Merge into documents that already exist; the ones that do not are reported,
// not created (the client lists them as failed).
async function updateDocs(
  ownerKey: string,
  deps: UploadDeps,
  ops: unknown,
): Promise<string[]> {
  if (!Array.isArray(ops)) return refuse(400, 'ops must be a list');
  if (ops.length > MAX_OPS) return refuse(413, 'too many ops in one request');
  const writes: Write[] = [];
  const failed: string[] = [];
  for (const op of ops as Array<Record<string, unknown>>) {
    checkId(op?.coll, op?.id, UPDATABLE);
    const coll = op.coll as string;
    const path = docPath(ownerKey, coll, op.id as string);
    const data = cleanDoc(op.data);
    for (const key of Object.keys(data))
      if (!UPDATE_FIELDS.has(key))
        return refuse(400, `field not updatable: ${key}`);
    const existing = await deps.docs.get(path);
    mustBeMine(existing, ownerKey, coll);
    if (!existing) failed.push(`${coll}/${String(op.id)}: not found`);
    else writes.push({op: 'update', path, data});
  }
  await deps.docs.commit(writes);
  return failed;
}

// -- the handler ------------------------------------------------------------

export async function handleUpload(
  deps: UploadDeps,
  req: UploadRequest,
): Promise<UploadResponse> {
  try {
    const header = req.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return refuse(401, 'sign in');
    let uid = '';
    try {
      ({uid} = await deps.verifyToken(token));
    } catch {
      return refuse(401, 'bad token');
    }
    if (!uid) return refuse(401, 'bad token');
    // Only an admin can write users/{uid}, so this cannot be talked into
    // another owner.
    const mapping = await deps.docs.get(`users/${uid}`);
    const key = mapping?.ownerKey;
    const ownerKey =
      typeof key === 'string' && SAFE_SEGMENT.test(key) ? key : uid;
    if (!SAFE_SEGMENT.test(ownerKey)) return refuse(401, 'bad token');
    return await route(uid, ownerKey, deps, req);
  } catch (error) {
    if (error instanceof Refused)
      return {status: error.status, json: {error: error.message}};
    throw error;
  }
}

async function route(
  uid: string,
  ownerKey: string,
  deps: UploadDeps,
  req: UploadRequest,
): Promise<UploadResponse> {
  const {method, path, query} = req;
  const body = (req.json ?? {}) as Record<string, unknown>;

  if (method === 'GET' && path === '/me')
    return {status: 200, json: {ownerKey}};

  const doc = path.match(/^\/doc\/([^/]+)\/([^/]+)$/);
  if (method === 'GET' && doc) {
    checkId(doc[1], doc[2], READABLE);
    const data = await deps.docs.get(docPath(ownerKey, doc[1], doc[2]));
    // 404, not 403, so another owner's ids do not leak.
    if (!data || isTheirs(data, ownerKey, doc[1]))
      return refuse(404, 'no such document');
    return {status: 200, json: data};
  }
  if (method === 'POST' && path === '/docs/write') {
    await writeDocs(uid, ownerKey, deps, body.ops);
    return {status: 204};
  }
  if (method === 'POST' && path === '/docs/update')
    return {
      status: 200,
      json: {failed: await updateDocs(ownerKey, deps, body.ops)},
    };
  if (method === 'GET' && path === '/laps') {
    const sessionId = query.sessionId;
    if (!sessionId || !SAFE_SEGMENT.test(sessionId))
      return refuse(400, 'bad sessionId');
    return {
      status: 200,
      json: {ids: await deps.docs.lapIds('laps', sessionId, ownerKey)},
    };
  }

  if (method === 'GET' && path === '/file/md5') {
    const stat = await deps.files.stat(filePath(ownerKey, query.dest));
    return {status: 200, json: {md5: stat ? stat.md5Hash : null}};
  }
  if (method === 'POST' && path === '/file/upload-url') {
    const full = filePath(ownerKey, body.dest);
    const size = body.size;
    if (typeof size !== 'number' || !Number.isInteger(size) || size < 0)
      return refuse(400, 'size must be a whole number of bytes');
    if (size > MAX_FILE_BYTES) return refuse(413, 'file too large');
    const type = body.contentType;
    if (typeof type !== 'string' || !CONTENT_TYPE.test(type))
      return refuse(400, 'bad contentType');
    const before = await deps.files.stat(full);
    const signed = await deps.files.signedUpload(full, {
      contentType: type,
      contentEncoding: body.gzip === true ? 'gzip' : undefined,
      maxBytes: size,
      expiresMs: UPLOAD_URL_MS,
    });
    // Counted when the URL is issued, at the most Storage will accept for it:
    // the bytes arrive later, straight from the client, and an abandoned
    // upload over-counts until the next recount.
    await deps.docs.addUsage(uid, {
      docs: 0,
      docBytes: 0,
      files: before ? 0 : 1,
      fileBytes: size - (before?.size ?? 0),
    });
    return {status: 200, json: signed};
  }
  if (method === 'GET' && path === '/file') {
    const bytes = await deps.files.read(filePath(ownerKey, query.dest));
    if (!bytes) return refuse(404, 'no such file');
    return {status: 200, bytes};
  }
  if (method === 'DELETE' && path === '/file') {
    const full = filePath(ownerKey, query.dest);
    const before = await deps.files.stat(full);
    if (!before) return refuse(404, 'no such file');
    await deps.files.remove(full);
    await deps.docs.addUsage(uid, {
      docs: 0,
      docBytes: 0,
      files: -1,
      fileBytes: -before.size,
    });
    return {status: 204};
  }
  if (method === 'GET' && path === '/files') {
    const prefix = query.prefix;
    if (!prefix || prefix.length > 400) return refuse(400, 'bad prefix');
    // A folder prefix, ending in "/": checked like a file path one level deeper.
    const folder = prefix.replace(/\/$/, '');
    const stored = filePath(ownerKey, `${folder}/x`).slice(0, -1);
    const names = await deps.files.list(stored);
    return {
      status: 200,
      json: {names: names.map(n => clientName(ownerKey, n))},
    };
  }
  return refuse(404, 'no such endpoint');
}
