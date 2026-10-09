// GET /api/tray/latest and /api/tray/download: where the BotRacing tray's
// installer and updates come from (pit-wall thread 54, chief's plan #2437).
// Anonymous on purpose: the updater runs before anyone is signed in, and the
// installer is the same file for everyone. CI publishes two things to Storage
// (the tray release workflow): `tray/latest.json` =
// {version, notes, pub_date, installer, signature} and the installer itself at
// `tray/<version>/<installer>`. This turns them into Tauri's updater manifest
// with a short-lived signed URL, and into a redirect for the Download button.
// Pure over `TrayDeps`, so it is tested without Firebase.

export interface TrayDeps {
  /** The bytes of an object in the release bucket; null when it is not there. */
  read(path: string): Promise<Uint8Array | null>;
  exists(path: string): Promise<boolean>;
  /** A signed GET URL for the object, valid for `expiresMs`. */
  signedDownload(path: string, expiresMs: number): Promise<string>;
}

export interface TrayRequest {
  method: string;
  /** The path after /api/tray, e.g. "/latest". */
  path: string;
}

export interface TrayResponse {
  status: number;
  json?: unknown;
  /** Set for a redirect. */
  location?: string;
}

/** One hour: the updater downloads right after it reads the manifest. */
export const URL_TTL_MS = 60 * 60 * 1000;
export const MANIFEST_PATH = 'tray/latest.json';
/** Tauri's key for the 64-bit Windows build. */
export const PLATFORM = 'windows-x86_64';

const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
// A file name only: it becomes part of a Storage path.
const INSTALLER = /^[A-Za-z0-9._-]+\.exe$/;

export interface Release {
  version: string;
  notes: string;
  pubDate: string | null;
  installer: string;
  signature: string;
}

/** The manifest CI wrote, or null when it is not the shape the endpoint serves. */
export function parseRelease(bytes: Uint8Array): Release | null {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.version !== 'string' || !VERSION.test(o.version)) return null;
  if (typeof o.installer !== 'string' || !INSTALLER.test(o.installer))
    return null;
  if (typeof o.signature !== 'string' || o.signature.length === 0) return null;
  return {
    version: o.version,
    notes: typeof o.notes === 'string' ? o.notes : '',
    pubDate: typeof o.pub_date === 'string' ? o.pub_date : null,
    installer: o.installer,
    signature: o.signature,
  };
}

export const installerPath = (r: Release) => `tray/${r.version}/${r.installer}`;

async function latest(
  deps: TrayDeps,
): Promise<{release: Release} | {response: TrayResponse}> {
  const bytes = await deps.read(MANIFEST_PATH);
  if (!bytes) return {response: {status: 404, json: {error: 'no release yet'}}};
  const release = parseRelease(bytes);
  if (!release)
    return {response: {status: 500, json: {error: 'release is not valid'}}};
  if (!(await deps.exists(installerPath(release))))
    return {response: {status: 404, json: {error: 'no release yet'}}};
  return {release};
}

export async function handleTray(
  deps: TrayDeps,
  req: TrayRequest,
): Promise<TrayResponse> {
  if (req.method !== 'GET') return {status: 405, json: {error: 'GET only'}};
  if (req.path !== '/latest' && req.path !== '/download')
    return {status: 404, json: {error: 'not found'}};
  const found = await latest(deps);
  if ('response' in found) return found.response;
  const {release} = found;
  const url = await deps.signedDownload(installerPath(release), URL_TTL_MS);
  if (req.path === '/download') return {status: 302, location: url};
  return {
    status: 200,
    json: {
      version: release.version,
      notes: release.notes,
      pub_date: release.pubDate ?? undefined,
      platforms: {[PLATFORM]: {signature: release.signature, url}},
    },
  };
}
