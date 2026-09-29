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
  const timer = setInterval(() => {
    if (stopped || !gameRunning()) return;
    stopped = true;
    clearInterval(timer);
    kill(child.pid);
  }, everyMs);
  return {stopped: () => stopped, cancel: () => clearInterval(timer)};
}
