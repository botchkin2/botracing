// How long a race is, from tools/capture's scoring stream.
//
// The recorder keeps the game's scoring info per update in
// `session-NNNN.parquet` (mSession, mGamePhase, mCurrentET, mEndET). Every
// race is timed (Botkin, pit-wall thread 54 #2655): mEndET is the end on the
// session clock, counted from the green flag. On the 3 Oct Road Atlanta race (a
// 40 minute event) mEndET was 2559 s and the first green update (phase 5) was
// at 159.4 s: 2399.6 s, which rounds to 40 minutes. The plan needs this: a
// timed race ends at the flag, a lap after the clock runs out, so the laps this
// driver completed are not its length (pit-wall thread 54 #2572).
import {existsSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {columns, sqlPath} from './duck.mjs';
import {capturesFor, listCaptures} from './field.mjs';

/** Session numbers from here are races (0 test day, 1-4 practice, 5-8 qualifying, 9 warm-up). */
export const FIRST_RACE_SESSION = 10;
/** mGamePhase while the race is green. */
const GREEN = 5;
/** Bump when the rule changes: it reanalyzes every session once (analyze.mjs blockVersions). */
export const RACE_LENGTH_VERSION = 1;

/**
 * {minutes} from the extremes of the race's green updates, or null when they
 * do not say. `endEt`, `greenStartEt`: max mEndET and min mCurrentET.
 */
export function raceLengthOf({endEt, greenStartEt}) {
  if (!Number.isFinite(endEt) || !Number.isFinite(greenStartEt)) return null;
  const minutes = Math.round((endEt - greenStartEt) / 60);
  return minutes > 0 ? {minutes} : null;
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
    `SELECT max(mEndET) AS endEt, ` +
      `min(mCurrentET) AS greenStartEt ` +
      `FROM read_parquet([${files.map(sqlPath).join(', ')}]) ` +
      `WHERE mSession >= ${FIRST_RACE_SESSION} AND mGamePhase = ${GREEN}`,
  );
  return raceLengthOf({
    endEt: c.endEt?.[0],
    greenStartEt: c.greenStartEt?.[0],
  });
}
