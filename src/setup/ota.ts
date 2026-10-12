import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import {AppState} from 'react-native';

import {runLaunch} from './otaLaunch';
import {shouldReloadOnReturn} from './otaPolicy';

// Over-the-air updates apply on the first open (pit-wall thread 1 #4531, #4538).
// app.json's ON_LOAD check with no fallback only downloads, so a phone ran
// every update one launch late. This fetches on launch and on every return to
// the app, but reloads only where nothing is being read (otaPolicy.ts): before
// the first screen at launch, or on a return after a long time away. A fetched
// update that waits is pending and applies at the next such moment. Off in
// development and on web, where expo-updates is disabled.

let pending = false;
let inFlight: Promise<boolean> | null = null;
let backgroundedMs: number | null = null;

/** Fetch an available update; true when one is downloaded and waiting. */
function fetchUpdate(): Promise<boolean> {
  if (pending) return Promise.resolve(true);
  inFlight ??= (async () => {
    try {
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) return false;
      await Updates.fetchUpdateAsync();
      pending = true;
      return true;
    } catch {
      // Offline or the server is down: the running bundle is fine.
      return false;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Call at module load, before the first render, so the splash waits. */
export function holdSplashForUpdate(): void {
  if (Updates.isEnabled) {
    void SplashScreen.preventAutoHideAsync().catch(() => {});
  }
}

function onLaunch(): Promise<void> {
  return runLaunch({
    fetchUpdate,
    reload: () => Updates.reloadAsync(),
    hideSplash: () => SplashScreen.hideAsync(),
  });
}

async function onReturn(): Promise<void> {
  const awayS =
    backgroundedMs === null ? 0 : (Date.now() - backgroundedMs) / 1000;
  backgroundedMs = null;
  const waiting = await fetchUpdate();
  if (waiting && shouldReloadOnReturn({backgroundedS: awayS})) {
    await Updates.reloadAsync();
  }
}

/** Start at app launch; returns the cleanup. */
export function startOtaUpdates(): () => void {
  if (!Updates.isEnabled) return () => {};
  void onLaunch().catch(() => {});
  const sub = AppState.addEventListener('change', state => {
    if (state === 'background') backgroundedMs = Date.now();
    if (state === 'active') void onReturn().catch(() => {});
  });
  return () => sub.remove();
}
