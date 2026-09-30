// Run: node --test tools/sessions/classLaps.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {encode} from './field.mjs';
import {carLaps, classLaps} from './classLaps.mjs';

const DT = 0.2;
const L = 4000;

// One car per entry: {class, lapS, offsetM, pitsAt, flagAt}; a car drives
// `laps` laps at a steady speed, its lap distance wrapping at L.
function build(specs, updates) {
  const r = {
    et: [],
    id: [],
    lapDist: [],
    pathLateral: [],
    x: [],
    z: [],
    oriX: [],
    oriZ: [],
    place: [],
    laps: [],
    inPits: [],
    flag: [],
  };
  specs.forEach((s, id) => {
    for (let u = 0; u < updates; u++) {
      const along = s.offsetM + ((u * DT) / s.lapS) * L;
      r.et.push(10 + u * DT);
      r.id.push(id);
      r.lapDist.push(along % L);
      r.pathLateral.push(0);
      r.x.push(0);
      r.z.push(0);
      r.oriX.push(0);
      r.oriZ.push(1);
      r.place.push(id + 1);
      r.laps.push(Math.floor(along / L));
      r.inPits.push(s.pitsAt?.(u) ? 1 : 0);
      r.flag.push(s.flagAt?.(u) ? 1 : 0);
    }
  });
  const cars = specs.map((s, id) => ({
    id,
    class: s.class,
    vehicle: null,
    player: id === 0,
  }));
  return encode(r, cars);
}

test('lap time is the crossing to crossing time, not the update time', () => {
  // 100.1 s laps: crossings fall between 5 Hz updates, so sample-time
  // differences would read 100.0 or 100.2.
  const f = build([{class: 'GT3', lapS: 100.1, offsetM: 10}], 3200);
  const laps = carLaps(f)[0];
  assert.ok(laps.length >= 3);
  for (const t of laps) assert.ok(Math.abs(t - 100.1) < 0.02, String(t));
});

test('the first crossing starts the clock and the first lap after it is the start', () => {
  // Crossings at updates 125, 625 and 1125: two measured laps, the first is
  // the start and is dropped.
  const f = build([{class: 'GT3', lapS: 100, offsetM: 3000}], 1500);
  assert.equal(carLaps(f)[0].length, 1);
});

test('a lap with a pit visit, a flag, or a gap in the field is left out', () => {
  const pit = u => u > 1520 && u < 1540; // in the lap ending at 2000
  const flag = u => u > 2020 && u < 2040; // in the lap ending at 2500
  const f = build(
    [{class: 'GT3', lapS: 100, offsetM: 0, pitsAt: pit, flagAt: flag}],
    3200,
  );
  // Crossings at updates 500 (clock), 1000 (the start, dropped), 1500 (counts),
  // 2000 (pit), 2500 (flag), 3000 (counts).
  assert.equal(carLaps(f)[0].length, 2);
});

test('classes pool per class key and one odd name does not split a class', () => {
  const f = build(
    [
      {class: 'GT3', lapS: 110, offsetM: 0},
      {class: 'GT3', lapS: 111, offsetM: 500},
      {class: 'Hyper', lapS: 97, offsetM: 0},
      {class: 'Hypercar', lapS: 97.4, offsetM: 900},
    ],
    3200,
  );
  const c = classLaps(f);
  assert.equal(c.gt3.cars, 2);
  assert.equal(c.hypercar.cars, 2);
  assert.ok(Math.abs(c.gt3.medianS - 110.5) < 0.6);
  assert.ok(Math.abs(c.hypercar.medianS - 97.2) < 0.4);
  assert.ok(c.hypercar.p10S <= c.hypercar.medianS);
  assert.ok(c.hypercar.p90S >= c.hypercar.medianS);
});

test('a slow car is cut at 1.15 x the class median', () => {
  const f = build(
    [
      {class: 'GT3', lapS: 100, offsetM: 0},
      {class: 'GT3', lapS: 100, offsetM: 100},
      {class: 'GT3', lapS: 140, offsetM: 200},
    ],
    3000,
  );
  const c = classLaps(f);
  assert.equal(c.gt3.cars, 2);
  assert.ok(c.gt3.medianS < 101);
});

test('under three laps is no class pace, and no class gives null', () => {
  const f = build([{class: 'GT3', lapS: 100, offsetM: 0}], 1300); // 2 full laps max
  assert.equal(classLaps(f), null);
});
