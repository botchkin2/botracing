// GET /api/android/latest and /api/android/download: the Android APK the
// android-v* release workflow publishes (pit-wall thread 1 #3270 to #3272).
// CI writes `android/latest.json` with scripts/android-release.mjs
// (buildLatest), the one producer: {version, versionCode, apk, sha256,
// cert_sha256, published_at}, and the APK at `android/<version>/<file>.apk`.
// /latest answers the Settings Download card with the version, the
// versionCode it compares on, and a short-lived signed URL; /download
// redirects to that URL. The serving rules are releaseCore.ts's.
import {
  handleRelease,
  jsonOf,
  objectUnder,
  type ReleaseDeps,
  type ReleaseKind,
  type ReleaseRequest,
  VERSION,
} from './releaseCore.ts';

export const ANDROID_MANIFEST_PATH = 'android/latest.json';

const FILE = /^[A-Za-z0-9._-]+\.apk$/;
const SHA256 = /^[0-9a-f]{64}$/;

export interface AndroidRelease {
  version: string;
  /** What EAS built; the app compares on this, never on the name. */
  versionCode: number;
  /** The APK's object path, `android/<version>/<file>.apk`. */
  apk: string;
  sha256: string;
  certSha256: string;
  publishedAt: string | null;
}

/** The manifest CI wrote, or null when it is not the shape the endpoint serves. */
export function parseAndroidRelease(bytes: Uint8Array): AndroidRelease | null {
  const raw = jsonOf(bytes);
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.version !== 'string' || !VERSION.test(o.version)) return null;
  if (
    typeof o.versionCode !== 'number' ||
    !Number.isInteger(o.versionCode) ||
    o.versionCode < 1
  )
    return null;
  const apk = objectUnder('android', o.version, o.apk, FILE);
  if (apk == null) return null;
  if (typeof o.sha256 !== 'string' || !SHA256.test(o.sha256)) return null;
  if (typeof o.cert_sha256 !== 'string' || !SHA256.test(o.cert_sha256))
    return null;
  return {
    version: o.version,
    versionCode: o.versionCode,
    apk,
    sha256: o.sha256,
    certSha256: o.cert_sha256,
    publishedAt: typeof o.published_at === 'string' ? o.published_at : null,
  };
}

const ANDROID: ReleaseKind<AndroidRelease> = {
  manifestPath: ANDROID_MANIFEST_PATH,
  parse: parseAndroidRelease,
  objectPath: r => r.apk,
  latestJson: (r, url) => ({
    version: r.version,
    versionCode: r.versionCode,
    sha256: r.sha256,
    published_at: r.publishedAt ?? undefined,
    url,
  }),
};

export const handleAndroid = (deps: ReleaseDeps, req: ReleaseRequest) =>
  handleRelease(ANDROID, deps, req);
