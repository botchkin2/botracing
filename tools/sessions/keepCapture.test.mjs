// Run: node --test tools/sessions/keepCapture.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  keepVisits,
  onlineAfterSync,
  raceAfterSync,
  visitAfterSync,
  visitUsedDamage,
} from './keepCapture.mjs';

const lmuRace = {sim: 'lmu', sessionType: 'Race'};
const repair = {
  v: 3,
  kind: 'repair',
  detail: null,
  did: ['repair'],
  stationaryS: 61,
  evidence: ['stationary 61 s', 'damage repaired'],
};
const stopGo = {
  v: 3,
  kind: 'penalty',
  detail: 'stop-go',
  did: [],
  stationaryS: 10.4,
  evidence: ['stationary 10.4 s'],
};
const unknown = {
  v: 3,
  kind: 'unknown',
  detail: null,
  did: [],
  stationaryS: 61,
  evidence: ['stationary 61 s', 'no damage record'],
};
const service = {
  v: 3,
  kind: 'service',
  detail: null,
  did: ['refuel'],
  stationaryS: 30,
  evidence: ['stationary 30 s', 'fuel or VE added'],
};

test('a new race length wins; none keeps the stored one in an LMU race', () => {
  assert.deepEqual(raceAfterSync({minutes: 40}, {minutes: 30}, lmuRace), {
    minutes: 40,
  });
  assert.deepEqual(raceAfterSync(null, {minutes: 40}, lmuRace), {minutes: 40});
  assert.equal(raceAfterSync(null, null, lmuRace), null);
});

test('the race length is kept only for an LMU race', () => {
  assert.equal(
    raceAfterSync(null, {minutes: 40}, {sim: 'iracing', sessionType: 'Race'}),
    null,
  );
  assert.equal(
    raceAfterSync(null, {minutes: 40}, {sim: 'lmu', sessionType: 'Practice'}),
    null,
  );
});

test('a visit holds a damage fact when it is a repair, did a repair, or is a stop-go', () => {
  assert.equal(visitUsedDamage(repair), true);
  assert.equal(
    visitUsedDamage({...service, kind: 'service', did: ['refuel', 'repair']}),
    true,
  );
  assert.equal(visitUsedDamage(stopGo), true);
  assert.equal(visitUsedDamage(service), false);
  assert.equal(visitUsedDamage(unknown), false);
  assert.equal(visitUsedDamage(null), false);
});

test('without damage this run, a stored repair or stop-go stays', () => {
  assert.equal(visitAfterSync(unknown, repair, {damageMissing: true}), repair);
  assert.equal(visitAfterSync(service, repair, {damageMissing: true}), repair);
  assert.equal(visitAfterSync(unknown, stopGo, {damageMissing: true}), stopGo);
});

test('with damage this run, the fresh visit always wins', () => {
  assert.equal(
    visitAfterSync(service, repair, {damageMissing: false}),
    service,
  );
});

test('a stored visit with no damage fact gives way to the fresh one, so a rule change lands', () => {
  assert.equal(
    visitAfterSync(unknown, service, {damageMissing: true}),
    unknown,
  );
  assert.equal(
    visitAfterSync(service, unknown, {damageMissing: true}),
    service,
  );
});

test('keepVisits keeps the stored visit on the lap with the stop, and counts it', () => {
  const laps = [
    {id: 'a', pitStop: {inPitS: 90, visit: unknown}},
    {id: 'b', pitStop: {inPitS: 40, visit: service}},
    {id: 'c', pitStop: null},
  ];
  const stored = new Map([
    ['a', {pitStop: {visit: repair}}],
    ['b', {pitStop: {visit: service}}],
  ]);
  assert.equal(keepVisits(laps, stored, {damageMissing: true}), 1);
  assert.equal(laps[0].pitStop.visit, repair);
  assert.equal(laps[0].pitStop.inPitS, 90);
  assert.equal(laps[1].pitStop.visit, service);
  assert.equal(laps[2].pitStop, null);
});

test('keepVisits changes nothing when this run had the damage record', () => {
  const laps = [{id: 'a', pitStop: {visit: unknown}}];
  const stored = new Map([['a', {pitStop: {visit: repair}}]]);
  assert.equal(keepVisits(laps, stored, {damageMissing: false}), 0);
  assert.equal(laps[0].pitStop.visit, unknown);
});

// The whole upload path, over an in-memory backend: a resync with no capture.
test('a resync without the capture keeps the stored race length and the repair, and the plan reads them', async () => {
  const {createStore} = await import('./store.mjs');
  const docs = new Map([
    ['sessions/s1', {race: {minutes: 40}}],
    ['laps/l1', {pitStop: {inPitS: 95, visit: repair}}],
  ]);
  const backend = {
    getDoc: async (coll, id) => docs.get(`${coll}/${id}`) ?? null,
    writeDocs: async ops => {
      for (const op of ops)
        if (op.op === 'set') docs.set(`${op.coll}/${op.id}`, op.data);
    },
    sessionLapIds: async () => ['l1'],
    getFile: async () => null,
    fileMd5: async () => null,
    putFile: async () => {},
    deleteFile: async () => {},
    listFiles: async () => [],
  };
  const out = {
    session: {
      id: 's1',
      ownerId: 'o',
      sim: 'lmu',
      sessionType: 'Race',
      race: null,
      field: null,
      slices: null,
      fuel: null,
      result: null,
    },
    recordings: [],
    laps: [
      {
        id: 'l1',
        lapTime: 100,
        comparable: true,
        traffic: null,
        pitIn: true,
        fuel: {endL: 10, green: true, usedL: 3, veUsedPct: 0},
        pitStop: {inPitS: 95, visit: unknown},
      },
    ],
    lapWindows: [],
    files: [],
    traces: [],
    band: null,
    slices: null,
    track: null,
    boundaries: null,
    damageMissing: true,
  };
  await createStore(backend).upload(out);
  const written = docs.get('sessions/s1');
  assert.deepEqual(written.race, {minutes: 40});
  assert.equal(written.plan.race.minutes, 40);
  assert.equal(written.plan.race.stops[0].kind, 'repair');
  assert.equal(docs.get('laps/l1').pitStop.visit.kind, 'repair');
});

test('an upload API that cannot read lap docs keeps nothing and does not fail the sync', async () => {
  const {createStore} = await import('./store.mjs');
  const docs = new Map([['sessions/s1', {race: {minutes: 40}}]]);
  const backend = {
    getDoc: async (coll, id) => {
      if (coll === 'laps') throw new Error('403 not readable');
      return docs.get(`${coll}/${id}`) ?? null;
    },
    writeDocs: async ops => {
      for (const op of ops)
        if (op.op === 'set') docs.set(`${op.coll}/${op.id}`, op.data);
    },
    sessionLapIds: async () => [],
    getFile: async () => null,
    fileMd5: async () => null,
    putFile: async () => {},
    deleteFile: async () => {},
    listFiles: async () => [],
  };
  const out = {
    session: {
      id: 's1',
      ownerId: 'o',
      sim: 'lmu',
      sessionType: 'Race',
      race: null,
      field: null,
      slices: null,
      fuel: null,
      result: null,
    },
    recordings: [],
    laps: [
      {
        id: 'l1',
        lapTime: 100,
        comparable: true,
        traffic: null,
        pitStop: {inPitS: 95, visit: unknown},
      },
    ],
    lapWindows: [],
    files: [],
    traces: [],
    band: null,
    slices: null,
    track: null,
    boundaries: null,
    damageMissing: true,
  };
  await createStore(backend).upload(out);
  assert.deepEqual(docs.get('sessions/s1').race, {minutes: 40});
  assert.equal(docs.get('laps/l1').pitStop.visit.kind, 'unknown');
});

test('the online flag: a new value wins, offline is kept as false, absence keeps the stored one', () => {
  assert.equal(onlineAfterSync(true, false), true);
  assert.equal(onlineAfterSync(false, true), false);
  assert.equal(onlineAfterSync(null, false), false);
  assert.equal(onlineAfterSync(null, undefined), null);
});
