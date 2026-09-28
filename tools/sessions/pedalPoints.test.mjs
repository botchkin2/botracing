// Run: node --test tools/sessions/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {brakeStart, fullThrottleStart, sampleTicks} from './pedalPoints.mjs';

// 1 m per tick, so a tick's distance is its index.
const distAt = i => i;

test('sampleTicks: 50 Hz in a 100 Hz file lands on even ticks', () => {
  assert.deepEqual(sampleTicks(50, 100, 5, 11), {ticks: [6, 8, 10], before: 4});
  assert.deepEqual(sampleTicks(10, 100, 0, 25), {
    ticks: [0, 10, 20],
    before: null,
  });
  assert.deepEqual(sampleTicks(100, 100, 3, 5), {ticks: [3, 4, 5], before: 2});
});

test('brakeStart: a real sample, never an interpolated crossing', () => {
  // Held at 50 Hz and blended by the loader on the odd ticks.
  const brake = [0, 0, 0, 0, 4, 12, 20, 50, 80, 80, 80];
  const got = brakeStart(brake, sampleTicks(50, 100, 0, 10), distAt);
  // Tick 5 reads 12 but is a blend; the first real sample past 10% is tick 6.
  assert.deepEqual(got, {atM: 6, resM: 2});
});

test('brakeStart: finds the application ending at the corner, not an earlier dab', () => {
  const brake = [0, 30, 0, 0, 0, 0, 60, 60, 60];
  const got = brakeStart(brake, sampleTicks(100, 100, 0, 8), distAt);
  assert.deepEqual(got, {atM: 6, resM: 1});
});

test('brakeStart: trail braking that hovers near 10% stays one application', () => {
  const brake = [0, 0, 40, 80, 30, 9, 8, 11, 9, 5];
  const got = brakeStart(brake, sampleTicks(100, 100, 0, 9), distAt);
  assert.deepEqual(got, {atM: 2, resM: 1});
});

test('brakeStart: rest-foot pressure is not braking', () => {
  const brake = [1, 2, 1, 2, 1, 2];
  assert.equal(brakeStart(brake, sampleTicks(50, 100, 0, 5), distAt), null);
});

test('fullThrottleStart: first real sample at or past 95%', () => {
  const thr = [20, 40, 60, 80, 94, 97, 100, 100];
  const got = fullThrottleStart(thr, sampleTicks(50, 100, 0, 7), distAt);
  assert.deepEqual(got, {atM: 6, resM: 2});
  assert.equal(
    fullThrottleStart([90, 90], sampleTicks(50, 100, 0, 1), distAt),
    null,
  );
});

test('resolution comes from the sample before the window', () => {
  const brake = [0, 0, 0, 0, 50, 50];
  const got = brakeStart(brake, sampleTicks(50, 100, 4, 5), distAt);
  assert.deepEqual(got, {atM: 4, resM: 2});
});
