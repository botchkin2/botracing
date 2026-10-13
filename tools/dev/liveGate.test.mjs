import assert from 'node:assert/strict';
import {test} from 'node:test';
import {liveVerdict} from './liveGate.mjs';

test('every lap in the app within the limit passes', () => {
  const r = liveVerdict({laps: 3, latencyMs: new Map([[1, 7600], [2, 5600], [3, 4500]]), maxLapS: 10});
  assert.deepEqual(r, {pass: true, problems: []});
});

test('a slow lap fails the gate, as the 27.9 s first lap of 0.1.9 would have', () => {
  const r = liveVerdict({laps: 3, latencyMs: new Map([[1, 27900], [2, 3600], [3, 7200]]), maxLapS: 10});
  assert.equal(r.pass, false);
  assert.deepEqual(r.problems, ['lap 1 took 27.9 s (limit 10 s)']);
});

test('a lap that never reaches the app fails the gate', () => {
  const r = liveVerdict({laps: 2, latencyMs: new Map([[1, 4000]]), maxLapS: 10});
  assert.deepEqual(r.problems, ['lap 2 never reached the app']);
});

test('exactly at the limit passes', () => {
  assert.equal(liveVerdict({laps: 1, latencyMs: new Map([[1, 10000]]), maxLapS: 10}).pass, true);
});
