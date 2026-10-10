import assert from 'node:assert/strict';
import {test} from 'node:test';
import {steerSignOf, throttlePickup, turnInPoint} from './cornerInputs.mjs';

test('the steering sign is read off the lap’s own corners', () => {
  // Right is positive: a right corner peaks positive, a left one negative.
  assert.equal(
    steerSignOf([
      {dir: 1, peak: 30},
      {dir: -1, peak: -25},
    ]),
    1,
  );
  // Left is positive (iRacing).
  assert.equal(
    steerSignOf([
      {dir: 1, peak: -30},
      {dir: -1, peak: 25},
    ]),
    -1,
  );
  assert.equal(steerSignOf([]), 1);
});

test('turn-in is the last tick under 20 % of the peak on the corner’s side', () => {
  const steer = [0, 0, 1, 2, 6, 12, 20, 30, 20, 10, 0];
  const at = turnInPoint({
    steer: i => steer[i],
    sideSign: 1,
    peakFrom: 0,
    peakTo: 10,
    lowerTick: 0,
  });
  // Threshold 6: tick 3 (value 2) is the last under it before the peak at 7.
  assert.equal(at, 3);
  // The other side of the wheel has no corner here.
  assert.equal(
    turnInPoint({steer: i => steer[i], sideSign: -1, peakFrom: 0, peakTo: 10, lowerTick: 0}),
    null,
  );
});

test('a kink under the floor, or a wheel that never relaxed, has no turn-in', () => {
  assert.equal(
    turnInPoint({steer: () => 2, sideSign: 1, peakFrom: 0, peakTo: 5, lowerTick: 0}),
    null,
  );
  // Already past 20 % of the peak at the search's lower bound.
  const held = [25, 26, 27, 30, 29];
  assert.equal(
    turnInPoint({steer: i => held[i], sideSign: 1, peakFrom: 0, peakTo: 4, lowerTick: 0}),
    null,
  );
});

test('throttle pickup is the first open sample after the last closed one', () => {
  const values = [100, 0, 0, 3, 8, 12, 60, 100];
  const ticks = values.map((_, i) => i);
  const r = throttlePickup({values, ticks, distAt: i => i * 10});
  // Last under 5 is tick 3; 8 is not open yet; 12 at tick 5 is.
  assert.deepEqual(r, {atM: 50, minPct: 0});
});

test('a pedal that never closes is a lift: no pickup, how low it went', () => {
  const values = [100, 80, 69, 75, 100];
  const r = throttlePickup({
    values,
    ticks: values.map((_, i) => i),
    distAt: i => i,
  });
  assert.deepEqual(r, {atM: null, minPct: 69});
  assert.deepEqual(throttlePickup({values, ticks: [], distAt: i => i}), {
    atM: null,
    minPct: null,
  });
  // Closed to the end of the stretch: it never opened inside it.
  assert.deepEqual(
    throttlePickup({values: [100, 0, 0], ticks: [0, 1, 2], distAt: i => i}),
    {atM: null, minPct: 0},
  );
});
