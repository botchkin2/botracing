// GET /api/android/latest (functions/src/androidCore.ts): the newest Android
// APK the android-v* release workflow published. Raw JSON stops here; the
// Download card sees AndroidRelease.

export type AndroidRelease = {
  version: string;
  /** What EAS built; the card compares on this, never on the name. */
  versionCode: number;
};

/** The release's version and versionCode; null when it is not a usable release. */
export function toAndroidRelease(raw: unknown): AndroidRelease | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as {version?: unknown; versionCode?: unknown; url?: unknown};
  if (typeof o.version !== 'string' || o.version === '') return null;
  if (
    typeof o.versionCode !== 'number' ||
    !Number.isInteger(o.versionCode) ||
    o.versionCode < 1
  )
    return null;
  if (typeof o.url !== 'string' || o.url === '') return null;
  return {version: o.version, versionCode: o.versionCode};
}
