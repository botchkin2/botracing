// The tray's LMU recorder from 0.1.9 until #619 stepped mWheel[4] by 0, so
// every wheel column holds the front-left wheel (pit wall #5405). Such a
// capture is no source for a drive: its stretches cover no game file and get
// no live repair, so the game file builds the drive (flow B) with the four
// real wheels (#5408, #5410). Read from the data, not a version: the capture
// carries none, and a recurrence is caught the same way.
import {existsSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {rows, sqlPath} from './duck.mjs';

// Moving only: a parked car can read four equal pressures (spring #5408).
const MOVING_MS = 50 / 3.6;
// Real wheels at speed match on 1.9% of frames (Road Atlanta 10-01); the bug
// gives 100%.
const BROKEN_SHARE = 0.99;

const known = new Map();

/** True when the LMU capture in `dir` has the four wheels as one. */
export function brokenWheels(dir) {
  if (known.has(dir)) return known.get(dir);
  const players = existsSync(dir)
    ? readdirSync(dir).filter(f => /^player-\d+\.parquet$/.test(f))
    : [];
  let broken = false;
  if (players.length > 0) {
    const src = `read_parquet(${sqlPath(resolve(dir, 'player-*.parquet'))})`;
    const [r] = rows(
      ':memory:',
      `SELECT count(*) AS n,
         count(*) FILTER (WHERE fl_mPressure = fr_mPressure
           AND fl_mPressure = rl_mPressure AND fl_mPressure = rr_mPressure) AS same
       FROM ${src}
       WHERE sqrt(mLocalVel_x ^ 2 + mLocalVel_y ^ 2 + mLocalVel_z ^ 2) > ${MOVING_MS}`,
    );
    const n = Number(r?.n ?? 0);
    broken = n > 0 && Number(r.same) / n > BROKEN_SHARE;
  }
  known.set(dir, broken);
  return broken;
}

/**
 * The live index without the stretches of broken-wheel LMU captures
 * (liveSession.mjs readLiveIndex): what may cover a game file or be repaired.
 */
export function usableLiveIndex(index, captureRoot, broken = brokenWheels) {
  const out = {};
  for (const [key, span] of Object.entries(index)) {
    if (span.sim === 'lmu' && broken(resolve(captureRoot, key.split('#')[0])))
      continue;
    out[key] = span;
  }
  return out;
}
