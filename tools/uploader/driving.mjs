// Whether a drive is being recorded right now, from the telemetry folder
// alone (pit-wall thread 1 #4648 to #4652). Botkin's call: upload each drive
// when he is back in the garage, not only once the game is closed.
//
// LMU writes one .duckdb per drive out of the garage, through DuckDB's WAL
// (a .duckdb.wal beside it while it is written), and finishes it within a
// second of the return to the garage (trace log against file times, 2 Oct).
// iRacing writes one .ibt per drive and grows it while driving. So any file in
// the folder written in the last DRIVING_WINDOW_MS is a drive in progress; a
// WAL left by a crash months ago is old and does not count. A drive that
// starts during a sync shows the same way, and stops the sync (gameGuard.mjs).

/** A file written this recently is a drive being recorded. */
export const DRIVING_WINDOW_MS = 20_000;

/**
 * `files`: [{name, mtimeMs}] of the telemetry folder. True when any of them,
 * the recording or its WAL, was written in the last DRIVING_WINDOW_MS.
 */
export function drivingNow(files, nowMs, windowMs = DRIVING_WINDOW_MS) {
  return files.some(f => nowMs - f.mtimeMs < windowMs);
}
