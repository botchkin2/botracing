// When the watcher runs a sync. Pure, so it is tested without a game.

// A sync while LMU runs waits for this much quiet in the Telemetry folder
// (between sessions), and uses few workers so VR frame time is left alone.
export const QUIET_MIN = 10;
export const IN_GAME_JOBS = 2;

// Run when telemetry changed since the last sync started, and the game has
// just exited, is not running, or the folder has been quiet for QUIET_MIN.
export function decide({
  gameRunning,
  wasRunning,
  newestMtimeMs,
  lastRunAtMs,
  nowMs,
}) {
  if (newestMtimeMs == null) return {run: false, reason: 'no telemetry'};
  if (lastRunAtMs != null && newestMtimeMs <= lastRunAtMs) {
    return {run: false, reason: 'nothing new'};
  }
  if (wasRunning && !gameRunning) return {run: true, reason: 'game exited'};
  if (!gameRunning) return {run: true, reason: 'new telemetry'};
  if (nowMs - newestMtimeMs >= QUIET_MIN * 60 * 1000) {
    return {run: true, jobs: IN_GAME_JOBS, reason: 'quiet in game'};
  }
  return {run: false, reason: 'game running'};
}
