// How long a race is, from tools/capture's scoring stream.
//
// The recorder keeps the game's scoring info per update in
// `session-NNNN.parquet` (mSession, mGamePhase, mCurrentET, mEndET, mMaxLaps).
// A lap race has mMaxLaps below 2147483647 (INT_MAX, "no limit"). A timed race
// has no lap limit and an end time: mEndET on the session clock, counted from
// the green flag. On the 3 Oct Road Atlanta race (a 40 minute event) mEndET was
// 2559 s and the first green update (phase 5) was at 159.4 s: 2399.6 s, which
// rounds to 40 minutes. The plan needs this: the laps a race has are not the
// laps this driver completed (pit-wall thread 54 #2572).
import {existsSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {columns, sqlPath} from './duck.mjs';
import {capturesFor, listCaptures} from './field.mjs';

/** The game's "no lap limit". */
export const NO_LAP_LIMIT = 2147483647;
/** Session numbers from here are races (0 test day, 1-4 practice, 5-8 qualifying, 9 warm-up). */
export const FIRST_RACE_SESSION = 10;
/** mGamePhase while the race is green. */
const GREEN = 5;
/** Bump when the rule changes: it re-analyses every session once (analyze.mjs blockVersions). */
export const RACE_LENGTH_VERSION = 1;

/**
 * {kind: 'laps', laps} or {kind: 'timed', minutes} from the extremes of the
 * race's green updates, or null when they do not say.
 * `maxLaps`, `endEt`, `greenStartEt`: max mMaxLaps, max mEndET and min mCurrentET.
 */
export function raceLengthOf({maxLaps, endEt, greenStartEt}) {
  if (Number.isFinite(maxLaps) && maxLaps > 0 && maxLaps < NO_LAP_LIMIT)
    return {kind: 'laps', laps: Math.round(maxLaps)};
  if (!Number.isFinite(endEt) || !Number.isFinite(greenStartEt)) return null;
  const minutes = Math.round((endEt - greenStartEt) / 60);
  return minutes > 0 ? {kind: 'timed', minutes} : null;
}

/**
 * The length of the race a capture recorded, or null when no capture covers
 * the session or it holds no green race update. `session`: {tracks, startMs,
 * endMs} as for the field.
 */
export function raceLengthFor(captureRoot, session) {
  const files = [];
  for (const c of capturesFor(listCaptures(captureRoot), session)) {
    const dir = resolve(captureRoot, c.name);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (/^session-\d+\.parquet$/.test(f)) files.push(resolve(dir, f));
    }
  }
  if (files.length === 0) return null;
  const c = columns(
    ':memory:',
    `SELECT max(mMaxLaps) AS maxLaps, max(mEndET) AS endEt, ` +
      `min(mCurrentET) AS greenStartEt ` +
      `FROM read_parquet([${files.map(sqlPath).join(', ')}]) ` +
      `WHERE mSession >= ${FIRST_RACE_SESSION} AND mGamePhase = ${GREEN}`,
  );
  return raceLengthOf({
    maxLaps: c.maxLaps?.[0],
    endEt: c.endEt?.[0],
    greenStartEt: c.greenStartEt?.[0],
  });
}
