import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {run, sqlPath} from './duck.mjs';
import {needsDuckdb} from './duckTestSupport.mjs';
import {brokenWheels, usableLiveIndex} from './brokenWheels.mjs';

// A player chunk of `n` frames: moving at `speed` m/s, the four pressures
// equal (the 0.1.9 recorder) or each its own.
function capture(name, {n = 200, speed = 40, same, parkedSame = 0}) {
  const dir = resolve(mkdtempSync(resolve(tmpdir(), 'wheels-')), name);
  mkdirSync(dir);
  const p = same ? 'p' : 'p + 1';
  const rows = `SELECT ${speed}::DOUBLE AS mLocalVel_x, 0::DOUBLE AS mLocalVel_y, 0::DOUBLE AS mLocalVel_z,
      p AS fl_mPressure, ${p} AS fr_mPressure, ${same ? 'p' : 'p + 2'} AS rl_mPressure, ${same ? 'p' : 'p + 3'} AS rr_mPressure
    FROM (SELECT 150 + i * 0.01 AS p FROM range(${n}) t(i))
    UNION ALL SELECT 0, 0, 0, 160, 160, 160, 160 FROM range(${parkedSame})`;
  run(':memory:', `COPY (${rows}) TO ${sqlPath(resolve(dir, 'player-0000.parquet'))} (FORMAT parquet)`, {readonly: false});
  return dir;
}

test('the 0.1.9 recorder (four wheels as one) is broken; real wheels are not', needsDuckdb, () => {
  assert.equal(brokenWheels(capture('bug', {same: true})), true);
  assert.equal(brokenWheels(capture('real', {same: false})), false);
});

test('a parked car with four equal pressures is not broken: only moving frames count', needsDuckdb, () => {
  assert.equal(brokenWheels(capture('parked', {same: false, parkedSame: 5000})), false);
});

test('a capture with no player chunks is not broken', () => {
  assert.equal(brokenWheels(resolve(tmpdir(), 'no-such-capture')), false);
});

test("a broken LMU capture's stretches leave the live index; others and iRacing stay", () => {
  const index = {
    'bad#0': {sim: 'lmu', sessionId: 'a'},
    'bad#1': {sim: 'lmu', sessionId: 'a'},
    'good#0': {sim: 'lmu', sessionId: 'b'},
    'ir#0': {sim: 'iracing', sessionId: 'c'},
  };
  const broken = dir => /bad$|ir$/.test(dir);
  assert.deepEqual(Object.keys(usableLiveIndex(index, '/root', broken)), ['good#0', 'ir#0']);
});
