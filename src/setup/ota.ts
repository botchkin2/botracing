import {AppState} from 'react-native';
import * as Updates from 'expo-updates';

import {shouldReloadNow} from './otaPolicy';

// Over-the-air updates apply on the first open (pit-wall thread 1 #4531).
// app.json's ON_LOAD check with no fallback wait only downloads an update and
// runs it on the NEXT cold start, so a phone is always one launch behind. This
// asks on launch and on every return to the foreground, fetches, and reloads
// at a moment shouldReloadNow allows. Off in development and on web, where
// expo-updates is disabled.

const startedMs = Date.now();
let lastTouchMs = startedMs;
let busy = false;

/**
 * The root view's responder-capture hook: runs on every touch start, and
 * returns false so it only watches and never takes the touch from a control.
 */
export function noteTouch(): boolean {
  lastTouchMs = Date.now();
  return false;
}

async function applyUpdate(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    await Updates.fetchUpdateAsync();
    const now = Date.now();
    if (
      shouldReloadNow({
        sinceStartS: (now - startedMs) / 1000,
        idleS: (now - lastTouchMs) / 1000,
      })
    ) {
      await Updates.reloadAsync();
    }
    // Otherwise the fetched update is cached and runs on the next launch.
  } catch {
    // Offline or the server is down: the running bundle is fine.
  } finally {
    busy = false;
  }
}

/** Start at app launch; returns the cleanup. */
export function startOtaUpdates(): () => void {
  if (!Updates.isEnabled) return () => {};
  void applyUpdate();
  const sub = AppState.addEventListener('change', state => {
    if (state === 'active') void applyUpdate();
  });
  return () => sub.remove();
}
