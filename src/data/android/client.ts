import {HttpError, releaseApiUrl} from '../http';

import {type AndroidRelease, toAndroidRelease} from './adapters';

/**
 * The newest Android release, or null while there is none (404). Anonymous:
 * the APK is the same file for everyone, so no token goes with it.
 */
export async function fetchAndroidRelease(
  signal?: AbortSignal,
): Promise<AndroidRelease | null> {
  const response = await fetch(releaseApiUrl('android', '/latest'), {signal});
  if (response.status === 404) return null;
  if (!response.ok) throw new HttpError(response.status, '/android/latest');
  return toAndroidRelease(await response.json());
}

/** The stable link that redirects to the APK (a signed URL that expires). */
export const androidDownloadUrl = (): string =>
  releaseApiUrl('android', '/download');
