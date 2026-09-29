// Stops a running sync when LMU starts. The start-of-sync check is not
// enough once a sync can take ~15 min (a full resync after an
// analysisVersion bump): a race launched mid-sync would run under VR
// (pitlane, thread 28 #656). Stopping is safe: sync.mjs is resumable, since
// the next run redoes only sessions whose fingerprint is not stored yet.
export const GAME_CHECK_SEC = 5;

// Checks every everyMs; on the first check that finds the game, calls
// kill(pid) once. Returns stopped() and cancel().
export function stopWhenGameStarts(
  child,
  {gameRunning, kill, everyMs = GAME_CHECK_SEC * 1000},
) {
  let stopped = false;
  // This runs in a timer, outside any try: a throw here would end the
  // watcher itself (scrutineer #671, pitlane #686). A failed check just waits
  // for the next one; a failed kill means the sync had already exited.
  const timer = setInterval(() => {
    try {
      if (stopped || !gameRunning()) return;
      stopped = true;
      clearInterval(timer);
      kill(child.pid);
    } catch {
      // Check again next time, or already gone.
    }
  }, everyMs);
  return {stopped: () => stopped, cancel: () => clearInterval(timer)};
}
