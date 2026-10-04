// Run: node --test tools/sessions/pitVisit.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  ADDED_FUEL_MIN_L,
  PIT_VISIT_VERSION,
  STOPPED_MIN_S,
  classifyVisit,
  damageAt,
  repaired,
  stationaryS,
} from './pitVisit.mjs';

// 10 Hz speed: in the lane from 0 s, 17 s at the 60 km/h limit, then 'still'
// seconds standing, then 17 s out.
function lane(still) {
  const t = [];
  const speed = [];
  const end = 17 + still + 17;
  for (let i = 0; i <= end * 10; i++) {
    const s = i / 10;
    t.push(s);
    speed.push(s > 17 && s <= 17 + still ? 0 : 60);
  }
  return {t, speed, end};
}

test('stationaryS adds the time under the stationary speed inside the window', () => {
  const {t, speed, end} = lane(10);
  assert.ok(Math.abs(stationaryS(t, speed, 0, end) - 10) < 0.2);
  // Only the part of the stop inside the window counts.
  assert.ok(Math.abs(stationaryS(t, speed, 20, end) - 7) < 0.2);
  assert.equal(stationaryS(t, speed, 0, 10), 0);
  assert.equal(stationaryS([], [], 0, 10), 0);
});

const damage = {
  et: [0, 0.5, 1, 1.5, 2, 2.5, 3],
  dent: [0, 0, 2, 2, 2, 0, 0],
  detached: [0, 0, 1, 1, 1, 0, 0],
};

test('damageAt is the last sample at or before the time, null before the first', () => {
  assert.deepEqual(damageAt(damage, 1.2), {dent: 2, detached: 1});
  assert.deepEqual(damageAt(damage, 2.5), {dent: 0, detached: 0});
  assert.equal(damageAt(damage, -1), null);
  assert.equal(damageAt(null, 1), null);
});

test('repaired is true when the exit has less damage than the entry, null without samples', () => {
  assert.equal(repaired(damage, 1.2, 2.8), true);
  assert.equal(repaired(damage, 0.2, 0.8), false);
  // Damage taken during the stop (a wall in the lane) is not a repair.
  assert.equal(repaired(damage, 0.2, 1.8), false);
  assert.equal(repaired(null, 1, 2), null);
});

const none = {fuelL: 0, vePct: 0};
const base = {
  inPitS: 90,
  stationaryS: 20,
  added: none,
  tyresChanged: false,
  race: true,
};

test('a service: stopped, and fuel, VE or tyres were added or changed', () => {
  const fuel = classifyVisit({
    ...base,
    added: {fuelL: 60, vePct: 40},
    repaired: false,
  });
  assert.equal(fuel.kind, 'service');
  assert.deepEqual(fuel.did, ['refuel']);
  assert.equal(fuel.v, PIT_VISIT_VERSION);
  const tyres = classifyVisit({...base, tyresChanged: true, repaired: false});
  assert.equal(tyres.kind, 'service');
  assert.deepEqual(tyres.did, ['tyres']);
  // Without a damage record a service is still a service.
  assert.equal(
    classifyVisit({...base, added: {fuelL: 60, vePct: 40}, repaired: null})
      .kind,
    'service',
  );
});

test('a repair outranks a service, and lists what else happened', () => {
  const r = classifyVisit({
    ...base,
    added: {fuelL: 30, vePct: 20},
    tyresChanged: true,
    repaired: true,
  });
  assert.equal(r.kind, 'repair');
  assert.deepEqual(r.did, ['refuel', 'tyres', 'repair']);
  assert.ok(r.evidence.includes('damage repaired'));
});

test("tonight's Road Atlanta visits: 61 s stationary with the damage gone is a repair; 10.4 s stationary with nothing added is a penalty, a stop-go", () => {
  const one = classifyVisit({
    inPitS: 95.6,
    stationaryS: 61.4,
    added: none,
    tyresChanged: false,
    repaired: true,
  });
  assert.equal(one.kind, 'repair');
  assert.equal(one.stationaryS, 61.4);
  const two = classifyVisit({
    inPitS: 45.4,
    stationaryS: 10.4,
    added: none,
    tyresChanged: false,
    repaired: false,
    race: true,
  });
  assert.equal(two.kind, 'penalty');
  assert.equal(two.detail, 'stop-go');
  assert.equal(two.stationaryS, 10.4);
});

test('a visit that never stood still and did nothing is a drive-through penalty', () => {
  const r = classifyVisit({...base, stationaryS: 1.2, repaired: false});
  assert.equal(r.kind, 'penalty');
  assert.equal(r.detail, 'drive-through');
  // Standing still for less than the stop floor is not a stop.
  assert.equal(
    classifyVisit({...base, stationaryS: STOPPED_MIN_S - 0.1, repaired: null})
      .kind,
    'penalty',
  );
});

test('stopped with nothing done and no damage record is unknown, not a guess', () => {
  const r = classifyVisit({...base, repaired: null});
  assert.equal(r.kind, 'unknown');
  assert.ok(r.evidence.includes('no damage record'));
});

test('unknown when the window never ends or there is no speed channel', () => {
  assert.equal(
    classifyVisit({...base, inPitS: null, repaired: false}).kind,
    'unknown',
  );
  assert.equal(
    classifyVisit({...base, stationaryS: null, repaired: false}).kind,
    'unknown',
  );
});

test('added fuel just under the floor is noise, not a service', () => {
  const r = classifyVisit({
    ...base,
    added: {fuelL: ADDED_FUEL_MIN_L - 0.01, vePct: 0},
    repaired: false,
  });
  assert.equal(r.kind, 'penalty');
  assert.equal(r.detail, 'stop-go');
});

test('fuel or VE added while never standing still is unknown (a recording fault, not a service)', () => {
  const r = classifyVisit({
    ...base,
    stationaryS: 0.5,
    added: {fuelL: 20, vePct: 10},
    repaired: false,
  });
  assert.equal(r.kind, 'unknown');
});

test('outside a race a run through the lane is "through", and standing still with nothing done is unknown (parc #1957)', () => {
  const practice = {...base, race: false};
  const through = classifyVisit({
    ...practice,
    stationaryS: 1.2,
    repaired: false,
  });
  assert.equal(through.kind, 'through');
  assert.equal(through.detail, null);
  const stood = classifyVisit({...practice, repaired: false});
  assert.equal(stood.kind, 'unknown');
  // A repair is a repair in any session, and a service too.
  assert.equal(classifyVisit({...practice, repaired: true}).kind, 'repair');
  assert.equal(
    classifyVisit({...practice, added: {fuelL: 30, vePct: 20}, repaired: false})
      .kind,
    'service',
  );
});
