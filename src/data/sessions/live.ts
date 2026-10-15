// Live laps (pit-wall thread 66): the tray adds a lap to the session doc every
// minute or two while the game runs. The doc keeps `live` after the drive, so
// "live" is the stamp's age, not its presence.

/**
 * How often an open live session is read again. A lap shows once its cloud
 * analysis lands, and this poll is the last wait before the screen: at 5 s it
 * held laps 2-3 at ~14 s of the 15 s gate (pit wall thread 69). One small doc.
 */
export const LIVE_POLL_MS = 2_000;
/**
 * The cloud analyses a live session when its lap lands (functions/src/
 * liveAnalyze.ts, ~5 s). Until this long after the lap, an open does not ask
 * for its own analysis; past it, the open is the fallback for a failed run.
 */
export const LIVE_ANALYSIS_GRACE_MS = 60_000;
/** A lap lands every minute or two; past this the drive is over. */
export const LIVE_FRESH_MS = 10 * 60_000;

/**
 * `liveAt`: `live.updatedAt` in ms, null on a session that never was live.
 * The server's stamp is compared with this device's clock, so a clock a few
 * minutes off shifts the window by as much; harmless at 10 minutes.
 */
export function isLive(liveAt: number | null | undefined, now = Date.now()) {
  return liveAt != null && now - liveAt < LIVE_FRESH_MS;
}

/** Whether the lap at `liveAt` is still the live analysis's to run. */
export function liveAnalysisDue(
  liveAt: number | null | undefined,
  now = Date.now(),
) {
  return liveAt != null && now - liveAt < LIVE_ANALYSIS_GRACE_MS;
}

/** React Query's `refetchInterval` for a live session; false stops the poll. */
export function livePoll(liveAt: number | null | undefined) {
  return isLive(liveAt) ? LIVE_POLL_MS : false;
}
