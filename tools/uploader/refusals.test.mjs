import test from 'node:test';
import assert from 'node:assert/strict';
import {trackRefusals, REFUSAL_GAP_MS} from './refusals.mjs';

const MIN = 60 * 1000;
const refused = reason => ({state: 'refused', layoutOk: false, layoutReason: reason});

test('a refusal opens a record that outlives the recorder leaving refused', () => {
  let l = trackRefusals([], refused('car 0 lap distance -1664'), 1000);
  l = trackRefusals(l, refused('car 3 lap distance -1200'), 31000);
  l = trackRefusals(l, {state: 'no-game', layoutOk: null}, 99 * MIN);
  assert.deepEqual(l, [
    {firstAtMs: 1000, lastAtMs: 31000, count: 2, reason: 'car 3 lap distance -1200'},
  ]);
});

test('a refusal after a long gap is another drive; recording or waiting opens none', () => {
  let l = trackRefusals([], refused('a'), 0);
  l = trackRefusals(l, {state: 'recording', layoutOk: true}, MIN);
  assert.equal(l.length, 1);
  l = trackRefusals(l, refused('b'), REFUSAL_GAP_MS + 1);
  assert.equal(l.length, 2);
});

test('records age out after 14 days', () => {
  const l = trackRefusals([], refused('a'), 0);
  assert.equal(trackRefusals(l, null, 13 * 86400000).length, 1);
  assert.equal(trackRefusals(l, null, 15 * 86400000).length, 0);
});
