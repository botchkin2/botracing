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

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** '12 Oct 14:05', in the phone's time zone. */
export function publishedOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

/** What identifies the installed build, read off the phone. */
export type RunningBuild = {
  version: string | null;
  /** The native build number (versionCode); what an APK update compares on. */
  versionCode: number | null;
  /** expo-updates' runtimeVersion: the fingerprint an OTA update must match. */
  runtimeVersion: string | null;
  /** The EAS Update channel the build follows; null outside a release build. */
  channel: string | null;
  /** When the OTA update it runs was published (createdAt). */
  publishedAt: Date | null;
};

/**
 * The running build in one line, so a phone's state is read, not guessed:
 * "App 1.0.2 (8) · runtime cdf505f5 · production · 12 Oct 14:05". The last part
 * is 'built-in' when it runs the build's own bundle. Parts the phone does not
 * report are left out.
 */
export function runningLineOf(b: RunningBuild): string {
  const parts = [
    b.version ? `App ${b.version}` : 'App',
    b.runtimeVersion ? `runtime ${b.runtimeVersion.slice(0, 8)}` : null,
    b.channel,
    b.publishedAt ? publishedOf(b.publishedAt) : 'built-in',
  ];
  if (b.versionCode != null) parts[0] += ` (${b.versionCode})`;
  return parts.filter(Boolean).join(' · ');
}

/**
 * The running line for the app's card, or null where the card is not the
 * installed app. A release build's embedded bundle carries its own createdAt,
 * so it reads 'built-in' from isEmbeddedLaunch, not from the date.
 */
export function runningLine(
  q: RunningBuild & {surface: AndroidSurface; isEmbeddedLaunch: boolean},
): string | null {
  if (q.surface !== 'app') return null;
  return runningLineOf({
    ...q,
    publishedAt: q.isEmbeddedLaunch ? null : q.publishedAt,
  });
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
