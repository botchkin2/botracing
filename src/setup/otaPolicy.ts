// When a fetched OTA update may reload the app (pit-wall thread 1 #4531).
// Pure, so each moment is tested; setup/ota.ts supplies the clock and touches.

/** Seconds after the JS starts in which a reload is invisible: no screen has settled. */
export const LAUNCH_WINDOW_S = 10;

/** Seconds without a touch after which nothing is mid-interaction. */
export const IDLE_S = 5;

/**
 * Reload now, or leave the fetched update for the next launch. An update
 * fetched just after launch reloads before anything is on screen to lose; later
 * (back in the foreground) it reloads only once the screen has been left
 * alone, so a drag, a scrub or a typed value is never cut off.
 */
export function shouldReloadNow(q: {
  /** Seconds since the app's JS started. */
  sinceStartS: number;
  /** Seconds since the last touch; counts from the start before any touch. */
  idleS: number;
}): boolean {
  return q.sinceStartS <= LAUNCH_WINDOW_S || q.idleS >= IDLE_S;
}
