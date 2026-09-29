// Run: node --test tools/sessions/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {topSpeed} from './analyze.mjs';

test('top speed is the fastest recorded sample in the lap, at its distance', () => {
  // Ticks 2..6 are the lap; tick 0 is faster but belongs to the lap before.
  const s = {speed_kmh: [300, 100, 180, 262.4, 263.1, 250, 120]};
  const dist = [0, 40, 80, 120, 160];
  assert.deepEqual(topSpeed(s, 2, 6, dist), {
    maxSpeedKmh: 263.1,
    maxSpeedAtM: 80,
  });
});
