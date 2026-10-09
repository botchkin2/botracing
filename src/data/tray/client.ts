import {HttpError, releaseApiUrl} from '../http';

import {type TrayRelease, toTrayRelease} from './adapters';

/**
 * The newest Windows release, or null while there is none (404). Anonymous:
 * the installer is the same file for everyone, so no token goes with it.
 */
export async function fetchTrayRelease(
  signal?: AbortSignal,
): Promise<TrayRelease | null> {
  const response = await fetch(releaseApiUrl('tray', '/latest'), {signal});
  if (response.status === 404) return null;
  if (!response.ok) throw new HttpError(response.status, '/tray/latest');
  return toTrayRelease(await response.json());
}

/** The stable link that redirects to the installer (a signed URL that expires). */
export const trayDownloadUrl = (): string => releaseApiUrl('tray', '/download');
