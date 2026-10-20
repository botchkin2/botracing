import test from 'node:test';
import assert from 'node:assert/strict';
import {mutate, payload} from '../../contract/payloads.mjs';
import {trackRefusals, REFUSAL_GAP_MS} from './refusals.mjs';

const MIN = 60 * 1000;
// The recorder blocks of real beats (contract/payloads/heartbeat).
const beat = name => payload('heartbeat', name).recorder;
const refused = reason =>
  mutate(beat('0.1.15-in-game-rec-refused'), 'layoutReason', reason);
const noGame = beat('0.1.15-waiting-for-game-rec-no-game');
const recording = beat('0.1.10-in-game-rec-recording');

test('a refusal opens a record that outlives the recorder leaving refused', () => {
  let l = trackRefusals([], refused('car 0 lap distance -1664'), 1000);
  l = trackRefusals(l, refused('car 3 lap distance -1200'), 31000);
  l = trackRefusals(l, noGame, 99 * MIN);
  assert.deepEqual(l, [
    {firstAtMs: 1000, lastAtMs: 31000, count: 2, reason: 'car 3 lap distance -1200'},
  ]);
});

test('a refusal after a long gap is another drive; recording or waiting opens none', () => {
  let l = trackRefusals([], refused('a'), 0);
  l = trackRefusals(l, recording, MIN);
  assert.equal(l.length, 1);
  l = trackRefusals(l, refused('b'), REFUSAL_GAP_MS + 1);
  assert.equal(l.length, 2);
});

test('records age out after 14 days', () => {
  const l = trackRefusals([], refused('a'), 0);
  assert.equal(trackRefusals(l, null, 13 * 86400000).length, 1);
  assert.equal(trackRefusals(l, null, 15 * 86400000).length, 0);
});
