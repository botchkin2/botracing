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

// Live laps (pit-wall thread 66): while a sim runs, a lap its tray recorder
// has put on disk (the recorder status file's lastLapAt: LMU and iRacing) is
// uploaded on its own, as one archive part, without analysis on the PC. The one
// exception to "never while the game runs": the work is one lap's parquet read
// and a ~0.2 MB upload at idle priority, measured per lap before it ships.
export function decideLive({gameRunning, lastLapAtMs, lastLiveAtMs, liveBusy}) {
  if (!gameRunning) return {run: false, reason: 'game not running'};
  if (lastLapAtMs == null) return {run: false, reason: 'no lap yet'};
  if (liveBusy) return {run: false, reason: 'live upload running'};
  if (lastLiveAtMs != null && lastLapAtMs <= lastLiveAtMs)
    return {run: false, reason: 'no new lap'};
  return {run: true, reason: 'new lap'};
}

/**
 * Whether the watcher's wait between ticks ends now, from each live sim's
 * recorder status (status.json / status-iracing.json, null when absent) at the
 * start of the wait (`first`) and now: a new lap on disk (lastLapAt moved), or
 * a recorder that started recording since. The status is read every few
 * seconds whatever the state at the start: a wait that began before the game
 * did would otherwise sleep a whole tick and hold the drive's first lap (17.9 s
 * and 27.9 s in the replays, thread 66 #4790, thread 1 #4958).
 */
export function liveWake(first, now) {
  return now.some((st, i) => {
    const was = first[i];
    if ((st?.lastLapAt ?? null) !== (was?.lastLapAt ?? null)) return true;
    return st?.state === 'recording' && was?.state !== 'recording';
  });
}

/**
 * How long after a failed live upload the watcher tries again: 5 s, doubling
 * with each failure in a row, at most 30 s (one tick). A failed run is not
 * recorded as done, but the wait between ticks ended early only for a new
 * lap, so a network blip held the lap a whole tick (46.1 s for a lap whose
 * upload timed out on connecting, thread 1 #5006).
 */
export function liveRetryDelayMs(failuresInRow) {
  if (!(failuresInRow > 0)) return null;
  return Math.min(5_000 * 2 ** (failuresInRow - 1), 30_000);
}

/**
 * Whether the capture live laps were following (`dir`) has closed, so its last
 * lap must go up now: the recorder moved to another capture, or stopped
 * recording. On a game exit it keeps the last sessionDir and says no-game
 * (recorder.rs Status), so the sessionDir alone never tells (pit wall #5305).
 */
export function liveClosed(dir, recorder) {
  if (!dir) return false;
  if (!recorder) return false;
  return recorder.sessionDir !== dir || recorder.state !== 'recording';
}

/**
 * Whether the watcher should look for the game's results file now (sync.mjs
 * --results-live): on its first tick of a tray start, and every
 * RESULTS_EVERY_MS while a live session ended within windowMs, because the game
 * writes the file when the session ends, after the last live run
 * (resultsBacklog.mjs). `liveEnds` are the live index's session end times.
 */
export const RESULTS_EVERY_MS = 60_000;
export const RESULTS_WINDOW_MS = 30 * 60_000;
export function resultsDue({
  liveEnds,
  nowMs,
  lastRunMs,
  windowMs = RESULTS_WINDOW_MS,
}) {
  if (lastRunMs == null) return true;
  if (nowMs - lastRunMs < RESULTS_EVERY_MS) return false;
  return liveEnds.some(end => nowMs - end <= windowMs);
}
