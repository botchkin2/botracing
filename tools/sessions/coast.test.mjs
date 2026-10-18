import assert from 'node:assert/strict';
import {test} from 'node:test';

import {coastSeconds} from './coast.mjs';

const lap = (rows, hz = 10) => ({
  t: rows.map((_, i) => i / hz),
  throttle_pct: rows.map(r => r[0]),
  brake_pct: rows.map(r => r[1]),
  speed_kmh: rows.map(r => r[2]),
});

test('counts the time with both pedals under 5 % above 80 km/h, and nothing else', () => {
  const s = lap([
    [100, 0, 200], // flat out
    [0, 0, 200], // coast
    [0, 0, 190], // coast
    [4.9, 4.9, 180], // still coast: under 5 %
    [5, 0, 180], // throttle at 5 %: not
    [0, 60, 150], // braking: not
    [0, 0, 79], // under 80 km/h: not
    [0, 0, 120], // coast
  ]);
  // Four coasting samples at 0.1 s each.
  assert.equal(coastSeconds(s, 0, 7), 0.4);
});

test('a lap range is the samples after its first, so adjacent laps never count a sample twice', () => {
  const s = lap([
    [0, 0, 200],
    [0, 0, 200],
    [0, 0, 200],
    [0, 0, 200],
  ]);
  assert.equal(
    Math.round((coastSeconds(s, 0, 1) + coastSeconds(s, 1, 3)) * 100) / 100,
    0.3,
  );
});

test('no pedal channels: null, not zero', () => {
  assert.equal(coastSeconds({t: [0, 1], speed_kmh: [100, 100]}, 0, 1), null);
});

test('a dropped-frame gap is not coast: each sample owns at most 0.1 s', () => {
  // 10 Hz rows, then a 2 s hole, then rows again, all off-pedal at speed.
  const t = [0, 0.1, 0.2, 2.2, 2.3];
  const s = {
    t,
    throttle_pct: t.map(() => 0),
    brake_pct: t.map(() => 0),
    speed_kmh: t.map(() => 200),
  };
  // Four samples after the first, each counted at most 0.1 s: 0.4, not 2.3.
  assert.equal(coastSeconds(s, 0, 4), 0.4);
});
