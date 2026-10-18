// The session doc's `paceSet` (analyzeFromArchive.mjs): the opening set's lap
// times, read off the lap docs as the app's adapter reads them.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {paceSetTimes} from './analyzeFromArchive.mjs';

const lap = (lapTime, over = {}) => ({
  lapTime,
  timed: true,
  partial: false,
  incomplete: false,
  pitIn: false,
  pitOut: false,
  reasons: [],
  ...over,
});

test('the opening set: timed, whole, off the pit lane, not slow; other reasons stay in', () => {
  const times = paceSetTimes([
    lap(130, {partial: true, incomplete: true, reasons: ['partial']}),
    lap(125, {pitOut: true, reasons: ['pit-out']}),
    lap(121.4),
    lap(121.9, {reasons: ['offtrack']}),
    lap(128, {reasons: ['slow']}),
    lap(99, {timed: false, incomplete: true, reasons: ['untimed']}),
    lap(121.6),
    lap(126, {pitIn: true, reasons: ['pit-in']}),
  ]);
  assert.deepEqual(times, [121.4, 121.9, 121.6]);
});

test('under two laps there is no set', () => {
  assert.deepEqual(paceSetTimes([lap(121.4), lap(128, {reasons: ['slow']})]), []);
});
