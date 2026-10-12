import {
  LAUNCH_BACKSTOP_S,
  LAUNCH_HOLD_S,
  shouldReloadAtLaunch,
} from './otaPolicy';

// The launch flow behind the held splash (pit-wall thread 1 #4541). Its one
// guarantee: the splash always comes down. A hung check, a failed fetch or a
// rejected reload must never leave the app on the splash, because this ships
// by OTA to every phone and runs on every launch. Dependencies are passed in so
// the flow is tested without expo-updates.

export type LaunchDeps = {
  /** Check and fetch; true when an update is downloaded and waiting. */
  fetchUpdate: () => Promise<boolean>;
  reload: () => Promise<void>;
  hideSplash: () => Promise<void>;
};

export async function runLaunch(deps: LaunchDeps): Promise<void> {
  let hidden = false;
  let backstop: ReturnType<typeof setTimeout> | undefined;
  const hide = async () => {
    if (hidden) return;
    hidden = true;
    clearTimeout(backstop);
    try {
      await deps.hideSplash();
    } catch {
      // Already hidden, or the native side is gone: nothing left to do.
    }
  };
  // Whatever else happens, the splash is down by then. Only hide() disarms
  // it, so a reload that resolves without restarting still ends at the backstop.
  backstop = setTimeout(
    () => void hide(),
    (LAUNCH_HOLD_S + LAUNCH_BACKSTOP_S) * 1000,
  );
  let reloaded = false;
  try {
    const startedMs = Date.now();
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<false>(resolve => {
      holdTimer = setTimeout(() => resolve(false), LAUNCH_HOLD_S * 1000);
    });
    const fetched = await Promise.race([
      deps.fetchUpdate().catch(() => false),
      timedOut,
    ]);
    clearTimeout(holdTimer);
    const fetchedAfterS = fetched ? (Date.now() - startedMs) / 1000 : null;
    if (shouldReloadAtLaunch({fetchedAfterS})) {
      await deps.reload();
      // The restart is under way; the new bundle brings its own splash hold.
      reloaded = true;
    }
  } catch {
    // A rejected reload: stay on this bundle and show it.
  } finally {
    if (!reloaded) await hide();
  }
}
