import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkLapDurations,
  elevationFromLaps,
  keepMeasuredLaps,
} from './elevation.mjs';

const line = (len, heightAt) => {
  const n = 21;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = (len * i) / (n - 1);
    x[i] = d;
    y[i] = heightAt(d / len);
  }
  return {x, y, z};
};

test('median height is placed on the map length by lap fraction', () => {
  const laps = [0, 0.2, -0.2].map(bias => line(200, frac => frac * 50 + bias));
  const built = elevationFromLaps(laps, 100);
  assert.deepEqual(built.refusals, []);
  assert.equal(built.elevation.stepM, 10);
  assert.equal(built.elevation.heightM.length, 11);
  assert.equal(built.elevation.heightM[0], 0);
  assert.equal(built.elevation.heightM[5], 25);
  assert.equal(built.elevation.heightM[10], 50);
  assert.equal(built.elevation.source, 'capture mPos_y, lap-fraction aligned');
});

test('a short lap is left out of the median', () => {
  const laps = [
    line(100, f => f * 10),
    line(100, f => f * 10),
    line(100, f => f * 10),
    line(50, () => 99),
  ];
  const built = elevationFromLaps(laps, 100);
  assert.deepEqual(built.refusals, []);
  assert.equal(built.stats.dropped, 1);
  assert.equal(built.elevation.heightM[10], 10);
});

test('path lengths that disagree by more than 1% are refused', () => {
  const built = elevationFromLaps(
    [line(100, f => f), line(100.6, f => f), line(101.2, f => f)],
    100,
  );
  assert.equal(built.elevation, null);
  assert.match(built.refusals.join(' '), /path lengths differ/);
});

test('an in-lap is dropped even when its path length matches', () => {
  const good = [1, 2, 3].map(n => ({...line(100, () => 0), lapNumber: n}));
  const inLap = {...line(100, () => 40), lapNumber: 9};
  const picked = keepMeasuredLaps([...good, inLap], [1, 2, 3]);
  assert.equal(picked.dropped, 1);
  const built = elevationFromLaps(picked.laps, 100);
  assert.deepEqual(built.refusals, []);
  assert.equal(built.elevation.heightM[0], 0);
  assert.equal(built.elevation.heightM[5], 0);
});

test('a capture shifted by one lap is refused', () => {
  const session = [
    {lapNumber: 1, lapTime: 90},
    {lapNumber: 2, lapTime: 91.2},
    {lapNumber: 3, lapTime: 92.4},
  ];
  const capture = session.map(s => ({
    ...line(100, () => 0),
    lapNumber: s.lapNumber + 1,
    duration: s.lapTime,
  }));
  const picked = keepMeasuredLaps(capture, session);
  assert.equal(picked.dropped, 1);
  assert.deepEqual(
    picked.laps.map(l => l.lapNumber),
    [2, 3],
  );
  const timing = checkLapDurations(picked.laps, session);
  assert.equal(timing.matched, 0);
  assert.equal(timing.checked, 2);
  assert.match(timing.refusals.join(' '), /0\.1 s/);
  assert.match(timing.refusals.join(' '), /lap 2, 3/);
});

test('a capture within 0.1 s of lapTime passes', () => {
  const session = [
    {lapNumber: 1, lapTime: 90},
    {lapNumber: 2, lapTime: 91.2},
  ];
  const capture = session.map(s => ({
    lapNumber: s.lapNumber,
    duration: s.lapTime + 0.1,
  }));
  const timing = checkLapDurations(capture, session);
  assert.equal(timing.matched, 2);
  assert.deepEqual(timing.refusals, []);
});

test('height that wanders by more than 1 m is refused', () => {
  const built = elevationFromLaps(
    [line(100, () => 0), line(100, () => 0), line(100, () => 2)],
    100,
  );
  assert.equal(built.elevation, null);
  assert.match(built.refusals.join(' '), /height p95/);
});
