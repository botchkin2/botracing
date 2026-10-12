// Run: node --test tools/sessions/sessionLast.test.mjs
// The session doc carries the analysis stamp, so store.mjs writes it last and
// alone: a failure before it must leave the old stamp (pit-wall thread 1 #4565).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createStore} from './store.mjs';
import {analysisStamp} from './versionKey.mjs';

const repair = {
  v: 3,
  kind: 'repair',
  detail: null,
  did: ['repair'],
  stationaryS: 61,
  evidence: [],
};
const unknown = {
  v: 3,
  kind: 'unknown',
  detail: null,
  did: [],
  stationaryS: 61,
  evidence: [],
};

function backendOver(docs, {failLaps = false} = {}) {
  const calls = [];
  return {
    calls,
    getDoc: async (coll, id) => docs.get(`${coll}/${id}`) ?? null,
    writeDocs: async ops => {
      calls.push(ops.map(op => op.coll));
      if (failLaps && ops.some(op => op.coll === 'laps'))
        throw new Error('laps refused');
      for (const op of ops)
        if (op.op === 'set') docs.set(`${op.coll}/${op.id}`, op.data);
    },
    sessionLapIds: async () => [],
    fileMd5: async () => null,
    putFile: async () => {},
    deleteFile: async () => {},
    listFiles: async () => [],
  };
}

function outFor({damageMissing = false, race = {minutes: 40}} = {}) {
  return {
    session: {
      id: 's1',
      ownerId: 'o',
      sim: 'lmu',
      sessionType: 'Race',
      race,
      field: null,
      slices: null,
      fuel: null,
      result: null,
      analysis: analysisStamp(17, {pitVisit: 3, raceLength: 1, tyres: 2}),
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
    damageMissing,
  };
}

test('the session doc is written last, in a call of its own', async () => {
  const backend = backendOver(new Map());
  await createStore(backend).upload(outFor());
  assert.deepEqual(backend.calls, [['laps'], ['sessions']]);
});

test('a failed lap write leaves the stored session and its stamp as they were', async () => {
  const old = {analysis: analysisStamp(16, {}), race: {minutes: 40}};
  const docs = new Map([['sessions/s1', old]]);
  await assert.rejects(
    createStore(backendOver(docs, {failLaps: true})).upload(outFor()),
    /laps refused/,
  );
  assert.equal(docs.get('sessions/s1'), old);
});

test('a fresh run stamps no kept blocks', async () => {
  const docs = new Map();
  await createStore(backendOver(docs)).upload(outFor());
  assert.deepEqual(docs.get('sessions/s1').analysis.kept, []);
});

test('blocks taken from the stored docs are named in the stamp', async () => {
  const docs = new Map([
    [
      'sessions/s1',
      {
        race: {minutes: 40},
        analysis: analysisStamp(17, {pitVisit: 2, raceLength: 1, tyres: 1}),
      },
    ],
    ['laps/l1', {pitStop: {inPitS: 95, visit: repair}}],
  ]);
  await createStore(backendOver(docs)).upload(
    outFor({damageMissing: true, race: null}),
  );
  const stamp = docs.get('sessions/s1').analysis;
  assert.deepEqual(stamp.kept, ['pitVisit', 'raceLength']);
  assert.equal(stamp.v, 17);
  // A consumer reading the kept blocks sees the rules they were made under.
  assert.equal(stamp.blocks.pitVisit, 2);
  assert.equal(stamp.blocks.raceLength, 1);
  assert.equal(stamp.blocks.tyres, 2);
});

test('a session stored under newer rules is left alone: nothing is written', async () => {
  const newer = {analysis: analysisStamp(18, {}), race: {minutes: 40}};
  const docs = new Map([['sessions/s1', newer]]);
  const backend = backendOver(docs);
  const r = await createStore(backend).upload(outFor());
  assert.deepEqual(r, {skipped: 'newer'});
  assert.deepEqual(backend.calls, []);
  assert.equal(docs.get('sessions/s1'), newer);
});
