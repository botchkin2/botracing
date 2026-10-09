// GET /api/<kind>/latest and /api/<kind>/download for an app the release
// workflows publish to Storage: the Windows tray (trayCore.ts) and the Android
// APK (androidCore.ts). CI writes `<kind>/latest.json` and the file it names;
// this reads the manifest, checks the file is there, and answers with a
// short-lived signed URL (or a redirect to it, for a Download button).
// Anonymous on purpose: the file is the same for everyone, and an updater
// asks before anyone is signed in. Pure over `ReleaseDeps`, so it is tested
// without Firebase.

export interface ReleaseDeps {
  /** The bytes of an object in the release bucket; null when it is not there. */
  read(path: string): Promise<Uint8Array | null>;
  exists(path: string): Promise<boolean>;
  /** A signed GET URL for the object, valid for `expiresMs`. */
  signedDownload(path: string, expiresMs: number): Promise<string>;
}

export interface ReleaseRequest {
  method: string;
  /** The path after /api/<kind>, e.g. "/latest". */
  path: string;
}

export interface ReleaseResponse {
  status: number;
  json?: unknown;
  /** Set for a redirect. */
  location?: string;
}

/** One hour: an updater downloads right after it reads the manifest. */
export const URL_TTL_MS = 60 * 60 * 1000;

/** A release version: semver, with an optional pre-release part. */
export const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

/**
 * The file's object path when it is exactly `<prefix>/<version>/<file>`: a
 * plain file name (no `/`, no `..`) matching `file`, under the manifest's own
 * version, so a manifest cannot point at another release or folder. Null
 * otherwise.
 */
export function objectUnder(
  prefix: string,
  version: string,
  path: unknown,
  file: RegExp,
): string | null {
  const head = `${prefix}/${version}/`;
  if (typeof path !== 'string' || !path.startsWith(head)) return null;
  const name = path.slice(head.length);
  return file.test(name) && !name.includes('..') ? path : null;
}

/** What makes one kind of release: where its manifest is, how to read it, what /latest says. */
export interface ReleaseKind<R> {
  manifestPath: string;
  /** The manifest CI wrote, or null when it is not the shape served. */
  parse(bytes: Uint8Array): R | null;
  /** The released file's object path. */
  objectPath(r: R): string;
  /** The /latest body, given a signed URL for the file. */
  latestJson(r: R, url: string): unknown;
}

/** JSON from bytes, or undefined when they are not JSON. */
export function jsonOf(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

export async function handleRelease<R>(
  kind: ReleaseKind<R>,
  deps: ReleaseDeps,
  req: ReleaseRequest,
): Promise<ReleaseResponse> {
  if (req.method !== 'GET') return {status: 405, json: {error: 'GET only'}};
  if (req.path !== '/latest' && req.path !== '/download')
    return {status: 404, json: {error: 'not found'}};
  const bytes = await deps.read(kind.manifestPath);
  if (!bytes) return {status: 404, json: {error: 'no release yet'}};
  const release = kind.parse(bytes);
  if (!release) return {status: 500, json: {error: 'release is not valid'}};
  const path = kind.objectPath(release);
  if (!(await deps.exists(path)))
    return {status: 404, json: {error: 'no release yet'}};
  const url = await deps.signedDownload(path, URL_TTL_MS);
  if (req.path === '/download') return {status: 302, location: url};
  return {status: 200, json: kind.latestJson(release, url)};
}
