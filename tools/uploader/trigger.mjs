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
// sync started, the analysis version changed, or a failed session is due its
// retry. retryAtMs is a whole-run failure (the sync crashed, so nothing is
// known to be done) and blocks everything until it passes; sessionRetryAtMs
// is the earliest per-session retry (retries.mjs) and only adds a reason to
// run, because the failing sessions are skipped, not the rest; quietRetryAtMs
// is when files the last run skipped as too fresh are old enough to read.
export function decide({
  versionChanged = false,
  gameRunning,
  wasRunning,
  newestMtimeMs,
  lastRunAtMs,
  retryAtMs = null,
  sessionRetryAtMs = null,
  quietRetryAtMs = null,
  nowMs,
}) {
  if (gameRunning) return {run: false, reason: 'game running'};
  if (newestMtimeMs == null) return {run: false, reason: 'no telemetry'};
  // A crashed sync records neither the version nor the run time, so it waits
  // for its retry time whatever else is pending, or a bump would rerun it
  // every tick (scrutineer #671).
  if (retryAtMs != null) {
    return nowMs < retryAtMs
      ? {run: false, reason: 'retry later'}
      : {run: true, reason: 'retry'};
  }
  if (sessionRetryAtMs != null && nowMs >= sessionRetryAtMs)
    return {run: true, reason: 'retry'};
  // A new analysisVersion means every stored session is out of date: sync
  // them all once, the same way as new telemetry (never in game).
  if (versionChanged) return {run: true, reason: 'new analysis version'};
  // A run that left a file alone because it was written moments ago must look
  // again once the quiet time has passed: the file's time is older than that
  // run, so "nothing new" would never let it through (full-feature run on the
  // 0.1.3 candidate: a fresh .ibt waited for the next change to the folder).
  if (quietRetryAtMs != null && nowMs >= quietRetryAtMs)
    return {run: true, reason: 'files closed'};
  if (lastRunAtMs != null && newestMtimeMs <= lastRunAtMs) {
    return {run: false, reason: 'nothing new'};
  }
  return {run: true, reason: wasRunning ? 'game exited' : 'new telemetry'};
}
