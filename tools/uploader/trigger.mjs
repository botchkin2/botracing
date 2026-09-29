// When the watcher runs a sync. Pure, so it is tested without a game.
//
// Never while LMU runs: even at low priority, DuckDB IO and memory in the
// garage can cost VR frames, and frame time beats upload latency (apex,
// thread 30 #489).

// After a sync with failures, try again 30 min later, doubling after each
// failure in a row up to 8 h, so a session that always fails does not
// run the sync every half hour forever (pitlane #578).
export const RETRY_MIN = 30;
export const RETRY_MAX_MIN = 8 * 60;

export function retryDelayMin(failuresInRow) {
  return Math.min(
    RETRY_MAX_MIN,
    RETRY_MIN * 2 ** Math.max(0, failuresInRow - 1),
  );
}

// Run when the game is not running, and telemetry changed since the last
// clean sync started, the analysis version changed, or a failed sync is due
// its retry.
export function decide({
  versionChanged = false,
  gameRunning,
  wasRunning,
  newestMtimeMs,
  lastRunAtMs,
  retryAtMs = null,
  nowMs,
}) {
  if (gameRunning) return {run: false, reason: 'game running'};
  if (newestMtimeMs == null) return {run: false, reason: 'no telemetry'};
  // A new analysisVersion means every stored session is out of date: sync
  // them all once, the same way as new telemetry (never in game).
  if (versionChanged) return {run: true, reason: 'new analysis version'};
  if (retryAtMs != null) {
    return nowMs < retryAtMs
      ? {run: false, reason: 'retry later'}
      : {run: true, reason: 'retry'};
  }
  if (lastRunAtMs != null && newestMtimeMs <= lastRunAtMs) {
    return {run: false, reason: 'nothing new'};
  }
  return {run: true, reason: wasRunning ? 'game exited' : 'new telemetry'};
}
