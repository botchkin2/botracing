import assert from 'node:assert/strict';
import {test} from 'node:test';
import {longRaceField} from './longRaceField.mjs';

// a 4 s field at 2 Hz, 2 cars: one drives +1 m per update in x, one stands
const real = {
  v: 2,
  hz: 2,
  et0: 1,
  tDs: [0, 5, 5, 5, 5, 5, 5, 5],
  cars: [
    {i: 0, class: 'GT3', player: true},
    {i: 1, class: 'HY', player: false},
  ],
  xDm: [[0, 10, 10, 10, 10, 10, 10, 10], [5, 0, 0, 0, 0, 0, 0, 0]],
  zDm: [[0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]],
  lapDistDm: [[0, 10, 10, 10, 10, 10, 10, 10], [5, 0, 0, 0, 0, 0, 0, 0]],
  pathLateralDm: [[0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]],
  yawCrad: [[0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]],
  place: [[1, 1, 1, 1, 1, 1, 1, 1], [2, 2, 2, 2, 2, 2, 2, 2]],
  laps: [[0, 0, 0, 0, 1, 1, 1, 1], [0, 0, 0, 0, 0, 0, 0, 0]],
  inPits: [[0, 0, 0, 0, 0, 0, 0, 0], [1, 1, 1, 1, 1, 1, 1, 1]],
  flag: [[0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]],
};

test('the long field has the asked updates and cars, in the real one\'s format', () => {
  const long = longRaceField(real, {seconds: 20, cars: 5});
  assert.equal(long.tDs.length, 40);
  assert.equal(long.cars.length, 5);
  assert.deepEqual(long.cars.map(c => c.i), [0, 1, 2, 3, 4]);
  assert.equal(long.cars[2].class, 'GT3');
  assert.equal(long.v, 2);
  for (const key of ['xDm', 'zDm', 'lapDistDm', 'pathLateralDm', 'yawCrad', 'place', 'laps', 'inPits', 'flag']) {
    assert.equal(long[key].length, 5, key);
    for (const row of long[key]) assert.equal(row.length, 40, key);
  }
});

test('a repeated path jumps back to where the real one started, so it does not drift', () => {
  const long = longRaceField(real, {seconds: 20, cars: 2});
  const x = long.xDm[0];
  let at = 0;
  const seen = [];
  for (let u = 0; u < x.length; u++) {
    at += x[u];
    if (u % 8 === 7) seen.push(at);
  }
  // the real path ends at 70 dm; every repeat ends there again
  assert.deepEqual(new Set(seen), new Set([70]));
});

test('laps keep counting across repeats and the other plain channels repeat as they are', () => {
  const long = longRaceField(real, {seconds: 8, cars: 2});
  assert.deepEqual(long.laps[0].slice(0, 8), [0, 0, 0, 0, 1, 1, 1, 1]);
  assert.deepEqual(long.laps[0].slice(8, 16), [1, 1, 1, 1, 2, 2, 2, 2]);
  assert.deepEqual(long.place[1], new Array(16).fill(2));
});

test('what the lap logic of the app reads stays sane: laps never go down, places stay 1..cars and unique per update, inPits is 0 or 1', () => {
  const long = longRaceField(real, {seconds: 20, cars: 5});
  for (const row of long.laps) for (let u = 1; u < row.length; u++) assert.ok(row[u] >= row[u - 1], 'laps went down');
  for (let u = 0; u < 40; u++) {
    const places = long.place.map(row => row[u]);
    assert.ok(places.every(p => p >= 1 && p <= 5), 'place out of range');
    assert.equal(new Set(places).size, 5, 'two cars share a place');
  }
  assert.deepEqual(long.place.slice(2).map(row => row[0]), [3, 4, 5]);
  for (const row of long.inPits) assert.ok(row.every(v => v === 0 || v === 1));
});
