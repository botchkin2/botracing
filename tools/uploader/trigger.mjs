// When the watcher runs a sync. Pure, so it is tested without a game.
//
// Never while LMU runs: even at low priority, DuckDB IO and memory in the
// garage can cost VR frames, and frame time beats upload latency (apex,
// thread 30 #489).

// After a sync with failures, try again this much later, not every tick.
export const RETRY_MIN = 30;

// Run when the game is not running, and telemetry changed since the last
// clean sync started, or a failed one is due its retry.
export function decide({
  gameRunning,
  wasRunning,
  newestMtimeMs,
  lastRunAtMs,
  retryAtMs = null,
  nowMs,
}) {
  if (gameRunning) return {run: false, reason: 'game running'};
  if (newestMtimeMs == null) return {run: false, reason: 'no telemetry'};
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
