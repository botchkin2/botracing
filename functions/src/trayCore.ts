// GET /api/tray/latest and /api/tray/download: where the BotRacing tray's
// installer and updates come from (pit-wall thread 54, chief's plan #2437).
// CI publishes two things to Storage (the tray release workflow):
// `tray/latest.json` = {version, notes, pub_date, installer, signature} and
// the installer itself at the object path `installer` names:
// `tray/<version>/<file>.exe`, written by desktop/scripts/release-manifest.mjs
// (buildLatest), the one producer. This turns them into Tauri's updater
// manifest with a short-lived signed URL, and into a redirect for the Download
// button. The serving rules are releaseCore.ts's, shared with Android.
import {
  handleRelease,
  jsonOf,
  objectUnder,
  type ReleaseDeps,
  type ReleaseKind,
  type ReleaseRequest,
  type ReleaseResponse,
  VERSION,
} from './releaseCore.ts';

export {URL_TTL_MS} from './releaseCore.ts';
export type TrayDeps = ReleaseDeps;
export type TrayRequest = ReleaseRequest;
export type TrayResponse = ReleaseResponse;

export const MANIFEST_PATH = 'tray/latest.json';
/** Tauri's key for the 64-bit Windows build. */
export const PLATFORM = 'windows-x86_64';

const FILE = /^[A-Za-z0-9._-]+\.exe$/;

export interface Release {
  version: string;
  notes: string;
  pubDate: string | null;
  /** The installer's object path, `tray/<version>/<file>.exe`. */
  installer: string;
  signature: string;
}

/** The manifest CI wrote, or null when it is not the shape the endpoint serves. */
export function parseRelease(bytes: Uint8Array): Release | null {
  const raw = jsonOf(bytes);
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.version !== 'string' || !VERSION.test(o.version)) return null;
  const installer = objectUnder('tray', o.version, o.installer, FILE);
  if (installer == null) return null;
  if (typeof o.signature !== 'string' || o.signature.length === 0) return null;
  return {
    version: o.version,
    notes: typeof o.notes === 'string' ? o.notes : '',
    pubDate: typeof o.pub_date === 'string' ? o.pub_date : null,
    installer,
    signature: o.signature,
  };
}

export const installerPath = (r: Release) => r.installer;

const TRAY: ReleaseKind<Release> = {
  manifestPath: MANIFEST_PATH,
  parse: parseRelease,
  objectPath: installerPath,
  latestJson: (release, url) => ({
    version: release.version,
    notes: release.notes,
    pub_date: release.pubDate ?? undefined,
    platforms: {[PLATFORM]: {signature: release.signature, url}},
  }),
};

export const handleTray = (deps: TrayDeps, req: TrayRequest) =>
  handleRelease(TRAY, deps, req);
