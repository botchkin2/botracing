// Live laps (pit-wall thread 66): the tray adds a lap to the session doc every
// minute or two while the game runs. The doc keeps `live` after the drive, so
// "live" is the stamp's age, not its presence.

/** How often a live session (and the list holding one) is read again. */
export const LIVE_POLL_MS = 5_000;
/** A lap lands every minute or two; past this the drive is over. */
export const LIVE_FRESH_MS = 10 * 60_000;

/** `liveAt`: `live.updatedAt` in ms, null on a session that never was live. */
export function isLive(liveAt: number | null | undefined, now = Date.now()) {
  return liveAt != null && now - liveAt < LIVE_FRESH_MS;
}

/** React Query's `refetchInterval` for a live session; false stops the poll. */
export function livePoll(liveAt: number | null | undefined) {
  return isLive(liveAt) ? LIVE_POLL_MS : false;
}
