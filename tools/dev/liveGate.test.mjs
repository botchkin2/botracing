import assert from 'node:assert/strict';
import {test} from 'node:test';
import {liveVerdict, screenLapCount} from './liveGate.mjs';

test('every lap in the app within the limit passes', () => {
  const r = liveVerdict({
    laps: 3,
    latencyMs: new Map([
      [1, 7600],
      [2, 5600],
      [3, 4500],
    ]),
    maxLapS: 10,
  });
  assert.deepEqual(r, {pass: true, problems: []});
});

test('a slow lap fails the gate, as the 27.9 s first lap of 0.1.9 would have', () => {
  const r = liveVerdict({
    laps: 3,
    latencyMs: new Map([
      [1, 27900],
      [2, 3600],
      [3, 7200],
    ]),
    maxLapS: 10,
  });
  assert.equal(r.pass, false);
  assert.deepEqual(r.problems, ['lap 1 took 27.9 s (limit 10 s)']);
});

test('a lap that never reaches the app fails the gate', () => {
  const r = liveVerdict({
    laps: 2,
    latencyMs: new Map([[1, 4000]]),
    maxLapS: 10,
  });
  assert.deepEqual(r.problems, ['lap 2 never reached the app']);
});

test('exactly at the limit passes', () => {
  assert.equal(
    liveVerdict({laps: 1, latencyMs: new Map([[1, 10000]]), maxLapS: 10}).pass,
    true,
  );
});

test('a lap the API has but the open screen never shows fails: the 0.1.9 miss', () => {
  const r = liveVerdict({
    laps: 2,
    latencyMs: new Map([[1, 4000]]),
    maxLapS: 15,
    where: 'the screen',
  });
  assert.deepEqual(r.problems, ['lap 2 never reached the screen']);
});

test('a lap that shows on the screen late says where it was late', () => {
  const r = liveVerdict({
    laps: 1,
    latencyMs: new Map([[1, 40000]]),
    maxLapS: 15,
    where: 'the screen',
  });
  assert.deepEqual(r.problems, [
    'lap 1 took 40.0 s on the screen (limit 15 s)',
  ]);
});

test('the screen lap count is read from the Session head line', () => {
  assert.equal(
    screenLapCount(
      'Race · Road Atlanta | BEST · SESSION | 44 laps · 38 comparable | LAP TIMES',
    ),
    44,
  );
  assert.equal(screenLapCount('3 laps · 0 comparable'), 3);
  assert.equal(screenLapCount("Couldn't load this session: 404"), null);
  assert.equal(screenLapCount(''), null);
});
