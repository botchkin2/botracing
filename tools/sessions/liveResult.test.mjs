// Run: node --test tools/sessions/liveResult.test.mjs
// A live race's result follows its newest field (pit wall thread 98): the
// cloud analysis runs with no field of its own and keeps what the session
// points at, so a result kept on its version alone stayed what lap 1 gave.
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {test} from 'node:test';
import {gzipSync} from 'node:zlib';

import {FINISH_VERSION} from '../../src/analysis/raceResult.ts';
import {madeFromField, stampField} from './field.mjs';
import {createStore} from './store.mjs';

// Three cars, four updates. The player (GT3) starts 3rd overall and 2nd in
// class, and is 1st overall at the last crossing, lap 3. No lap distance: this
// is about which field the blocks are read from, not what they say.
const none = [null, null, null, null];
const lap3 = {
  hz: 5,
  et0: 0,
  tDs: [0, 1000, 2000, 3000],
  pathLateralDm: [none, none, none],
  cars: [{class: 'GT3', player: true}, {class: 'GT3'}, {class: 'LMP2'}],
  place: [[3, 3, 2, 1], [2, 2, 3, 3], [1, 1, 1, 2]],
  laps: [[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]],
  lapDistDm: [none, none, none],
  inPits: [none, none, none],
  flag: [none, none, none],
};

const fieldRef = hash => ({path: `field/o/s1/${hash}.json.gz`, hash});

function stubBackend(stored, files) {
  const docs = new Map([['sessions/s1', stored]]);
  const reads = [];
  return {
    docs,
    reads,
    getDoc: async (coll, id) => docs.get(`${coll}/${id}`) ?? null,
    writeDocs: async ops => {
      for (const op of ops)
        if (op.op === 'set') docs.set(`${op.coll}/${op.id}`, op.data);
    },
    getFile: async path => {
      reads.push(path);
      return files[path] ?? null;
    },
    sessionLapIds: async () => [],
    fileMd5: async () => null,
    putFile: async () => {},
    deleteFile: async () => {},
    listFiles: async () => [],
  };
}

// What analyzeStored hands the store for a live session: no field of its own.
const cloudRun = () => ({
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
    classLaps: null,
    classBests: null,
  },
  recordings: [],
  laps: [],
  lapWindows: [],
  files: [],
  traces: [],
  band: null,
  slices: null,
  track: null,
  boundaries: null,
});

const gz = field => gzipSync(Buffer.from(JSON.stringify(field)));

test('a result made from an older field is worked out again from the one the session points at', async () => {
  const lap1Result = {
    version: FINISH_VERSION,
    kind: 'race',
    finish: {overall: 3, inClass: 2, lapsDone: 1},
    fieldHash: 'aaa',
  };
  const backend = stubBackend(
    {field: fieldRef('bbb'), result: lap1Result},
    {[fieldRef('bbb').path]: gz(lap3)},
  );
  await createStore(backend).upload(cloudRun());
  const written = backend.docs.get('sessions/s1');
  assert.equal(written.result.finish.overall, 1);
  assert.equal(written.result.finish.inClass, 1);
  assert.equal(written.result.finish.lapsDone, 3);
  assert.equal(written.result.fieldHash, 'bbb');
  assert.equal(written.classLaps.fieldHash, 'bbb');
  assert.equal(written.classBests.fieldHash, 'bbb');
});

test('a result stored before blocks named their field is worked out again once', async () => {
  const unnamed = {
    version: FINISH_VERSION,
    kind: 'race',
    finish: {overall: 3, inClass: 2, lapsDone: 1},
  };
  const backend = stubBackend(
    {field: fieldRef('bbb'), result: unnamed},
    {[fieldRef('bbb').path]: gz(lap3)},
  );
  await createStore(backend).upload(cloudRun());
  assert.equal(backend.docs.get('sessions/s1').result.finish.lapsDone, 3);
});

test('blocks made from the field the session points at are kept as stored', async () => {
  const first = stubBackend(
    {field: fieldRef('bbb')},
    {[fieldRef('bbb').path]: gz(lap3)},
  );
  await createStore(first).upload(cloudRun());
  const stored = first.docs.get('sessions/s1');
  // A stored block that differs from what the field gives: kept means kept.
  const marked = {...stored, result: {...stored.result, mark: 1}};
  const again = stubBackend(marked, {[fieldRef('bbb').path]: gz(lap3)});
  await createStore(again).upload(cloudRun());
  const written = again.docs.get('sessions/s1');
  assert.equal(written.result.mark, 1);
  assert.deepEqual(written.classLaps, stored.classLaps);
  assert.deepEqual(written.classBests, stored.classBests);
});

test('a field that cannot be read keeps the stored blocks, never null over them', async () => {
  const lap1Result = {
    version: FINISH_VERSION,
    kind: 'race',
    finish: {overall: 3, inClass: 2, lapsDone: 1},
    fieldHash: 'aaa',
  };
  const classLaps = {version: 0, kind: 'race', classes: {gt3: {}}};
  const logs = [];
  const backend = stubBackend(
    {field: fieldRef('bbb'), result: lap1Result, classLaps},
    {},
  );
  backend.getFile = async () => {
    throw new Error('storage is down');
  };
  await createStore(backend).upload(cloudRun(), {log: m => logs.push(m)});
  const written = backend.docs.get('sessions/s1');
  assert.deepEqual(written.result, lap1Result);
  assert.deepEqual(written.classLaps, classLaps);
  assert.equal(written.classBests, null);
  assert.ok(logs.includes('  field: unreadable, kept the stored result'));
  assert.ok(logs.includes('  field: unreadable, kept the stored classLaps'));
});

test('a marked stored field is kept and does not refill traffic, class laps, bests or the finish', async () => {
  for (const kind of ['garbage', 'misaligned', 'doubted', 'track']) {
    const backend = stubBackend(
      {
        field: {...fieldRef('bbb'), mark: {kind}, note: 'kept'},
        result: {
          version: FINISH_VERSION,
          kind: 'race',
          finish: {overall: 3, inClass: 2, lapsDone: 1},
          fieldHash: 'bbb',
        },
        classLaps: {version: 1, kind: 'race'},
        classBests: {version: 1},
      },
      {[fieldRef('bbb').path]: gz(lap3)},
    );
    const run = cloudRun();
    run.laps = [{id: 'L1', traffic: {aheadS: 1}}];
    run.lapWindows = [{from: 0, to: 10}];
    const logs = [];
    await createStore(backend).upload(run, {log: m => logs.push(m)});
    const written = backend.docs.get('sessions/s1');
    assert.equal(written.field.mark.kind, kind);
    assert.equal(written.classLaps, null);
    assert.equal(written.classBests, null);
    assert.equal(written.result, null);
    assert.equal(run.laps[0].traffic, null);
    assert.deepEqual(backend.reads, []);
    assert.ok(logs.includes('  field: marked, kept, not used'));
  }
});

test('a smaller aside on an unmarked field still refills from that field', async () => {
  const backend = stubBackend(
    {
      field: {
        ...fieldRef('bbb'),
        mark: {kind: 'smaller', aside: 'field/o/s1/small.json.gz'},
        aside: 'field/o/s1/small.json.gz',
      },
    },
    {[fieldRef('bbb').path]: gz(lap3)},
  );
  await createStore(backend).upload(cloudRun());
  assert.equal(backend.docs.get('sessions/s1').result.finish.overall, 1);
  assert.deepEqual(backend.reads, [fieldRef('bbb').path]);
});

test('stampField and madeFromField', () => {
  assert.equal(stampField(null, fieldRef('a')), null);
  assert.deepEqual(stampField({v: 1}, null), {v: 1, fieldHash: null});
  assert.equal(madeFromField({fieldHash: 'a'}, fieldRef('a')), true);
  assert.equal(madeFromField({fieldHash: 'a'}, fieldRef('b')), false);
  assert.equal(madeFromField({}, fieldRef('a')), false);
  assert.equal(madeFromField({fieldHash: null}, null), false);
});
