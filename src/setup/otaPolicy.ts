// When a fetched OTA update may reload the app (pit-wall thread 1 #4531, #4538).
// reloadAsync restarts at the initial route, so a reload is only allowed where
// nothing is being read: before the first screen shows, or when the driver
// comes back to the app after a long time away. Idle is not "not using": a
// chart studied without a touch is in use. Pure, so each moment is tested.

/** Seconds the splash is held at launch for the update check and fetch. */
export const LAUNCH_HOLD_S = 3;

/** Seconds in the background after which a return is a fresh start. */
export const FRESH_START_S = 30 * 60;

/**
 * Reload before the first screen when the update was fetched within the hold;
 * `fetchedAfterS` is null when there was none, or it was not in time.
 */
export function shouldReloadAtLaunch(q: {
  fetchedAfterS: number | null;
}): boolean {
  return q.fetchedAfterS !== null && q.fetchedAfterS <= LAUNCH_HOLD_S;
}

/** Reload on a return to the foreground only after a long time away. */
export function shouldReloadOnReturn(q: {backgroundedS: number}): boolean {
  return q.backgroundedS >= FRESH_START_S;
}
