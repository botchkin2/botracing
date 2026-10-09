import {type AndroidRelease} from '@/src/data/android';

// The Android app card on Settings (pit-wall thread 1 #3270 to #3272): where
// it shows, and what it says, from the state of the release query. Pure, so
// each state is tested.
//
// In the installed app it shows only when the release is newer, compared on
// versionCode (what EAS built), never on the name. In a phone's browser it
// offers the APK, like the Windows card. Elsewhere there is no card.

export type AndroidSurface = 'app' | 'browser' | 'none';

export function androidSurface(
  os: string,
  userAgent: string | undefined,
): AndroidSurface {
  if (os === 'android') return 'app';
  if (os === 'web' && /\bAndroid\b/.test(userAgent ?? '')) return 'browser';
  return 'none';
}

export type AndroidCard = {
  /** "v1.0.1", or why there is nothing to download. */
  status: string;
  /** The version a download offers; null when there is none. */
  version: string | null;
};

/** The download opens in the browser, so Android asks the browser, once. */
export const INSTALL_NOTE =
  'Android asks once to allow installs from the browser.';

export function androidCard(q: {
  surface: AndroidSurface;
  /** The installed app's versionCode; null when unknown or not the app. */
  installedVersionCode: number | null;
  isPending: boolean;
  isError: boolean;
  data: AndroidRelease | null | undefined;
}): AndroidCard | null {
  if (q.surface === 'none') return null;
  if (q.surface === 'app') {
    if (!q.data || q.installedVersionCode == null) return null;
    if (q.data.versionCode <= q.installedVersionCode) return null;
    return {status: `v${q.data.version}`, version: q.data.version};
  }
  if (q.data) return {status: `v${q.data.version}`, version: q.data.version};
  if (q.isPending) return {status: 'Checking…', version: null};
  if (q.isError)
    return {status: 'Couldn’t check for the Android app', version: null};
  return {status: 'Not released yet', version: null};
}
