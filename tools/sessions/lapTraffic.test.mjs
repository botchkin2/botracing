// Run: node --test tools/sessions/lapTraffic.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {encode} from './field.mjs';
import {lapTraffic, lapTrafficFrom} from './lapTraffic.mjs';
import {TRAFFIC_VERSION} from '../../src/analysis/traffic.ts';

const DT = 0.2;
const L = 4000;
const cars = [
  {id: 0, class: 'GT3', vehicle: 'A', player: true},
  {id: 1, class: 'Hyper', vehicle: 'B', player: false},
  // Parked far away: makes the lap 4000 m long for the wrap maths.
  {id: 2, class: 'GT3', vehicle: 'C', player: false},
];

// The player at 40 m/s from 1000 m; a Hypercar 100 m behind at 50 m/s passes
// them after 10 s.
function field(updates) {
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
  for (let u = 0; u < updates; u++) {
    const rows = {
      0: 1000 + u * DT * 40,
      1: 900 + u * DT * 50,
      2: 3900,
    };
    for (const c of cars) {
      r.et.push(10 + u * DT);
      r.id.push(c.id);
      r.lapDist.push(rows[c.id] % L);
      r.pathLateral.push(0);
      r.x.push(0);
      r.z.push(0);
      r.oriX.push(0);
      r.oriZ.push(1);
      r.place.push(c.id + 1);
      r.laps.push(1);
      r.inPits.push(0);
      r.flag.push(0);
    }
  }
  return encode(r, cars);
}

const windows = [{from: 0, to: 1e9}];

test('a lap block carries the version, the old counts and the faster-class passes', () => {
  const [t] = lapTraffic(field(200), windows);
  assert.equal(t.v, TRAFFIC_VERSION);
  assert.equal(typeof t.trafficAheadS, 'number');
  assert.equal(t.passesSufferedAll, 1);
  assert.equal(t.overtakes.length, 1);
  assert.equal(t.overtakes[0].cls, 'hypercar');
});

test('a fresh capture is read first, and the uploaded field is not touched', async () => {
  let loads = 0;
  const [t] = await lapTrafficFrom({
    fresh: field(200),
    stored: {path: 'p'},
    load: async () => (loads++, null),
    windows,
  });
  assert.equal(t.overtakes.length, 1);
  assert.equal(loads, 0);
});

test('a resync without the capture keeps the block, read from the uploaded field', async () => {
  const stored = field(200);
  const [t] = await lapTrafficFrom({
    fresh: null,
    stored: {path: 'p'},
    load: async () => stored,
    windows,
  });
  assert.equal(t.v, TRAFFIC_VERSION);
  assert.equal(t.overtakes.length, 1);
});

test('no capture and no stored field, or one that cannot be read, is null (and tried again next sync)', async () => {
  const none = await lapTrafficFrom({
    fresh: null,
    stored: null,
    load: async () => assert.fail('nothing to load'),
    windows,
  });
  assert.deepEqual(none, [null]);
  const broken = await lapTrafficFrom({
    fresh: null,
    stored: {path: 'p'},
    load: async () => null,
    windows,
  });
  assert.deepEqual(broken, [null]);
});
