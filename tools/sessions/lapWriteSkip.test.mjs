// Run: node --test tools/sessions/lapWriteSkip.test.mjs
// A live session is analysed again on every lap (pit wall thread 101, #38):
// a lap doc that comes out the same is not written again, and one that
// changed, or whose doc is gone, is.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {gunzipSync, gzipSync} from 'node:zlib';

import {createStore, lapHash} from './store.mjs';

// Like adminBackend: a lap with `supersededBy` is not among the session's laps.
function stubBackend(stored = null, lapIds = []) {
  const docs = new Map();
  if (stored) docs.set('sessions/s1', stored);
  const lapWrites = [];
  const present = new Set(lapIds);
  const files = new Map();
  return {
    docs,
    lapWrites,
    present,
    files,
    getDoc: async (coll, id) => docs.get(`${coll}/${id}`) ?? null,
    writeDocs: async ops => {
      for (const op of ops) {
        if (op.op !== 'set') continue;
        const key = `${op.coll}/${op.id}`;
        docs.set(key, op.merge ? {...docs.get(key), ...op.data} : op.data);
        if (op.coll === 'laps' && !op.merge) {
          lapWrites.push(op.id);
          present.add(op.id);
        }
      }
    },
    getFile: async dest => files.get(dest) ?? null,
    sessionLapIds: async () =>
      [...present].filter(id => !docs.get(`laps/${id}`)?.supersededBy),
    fileMd5: async () => null,
    putFile: async (dest, {body}) => files.set(dest, gzipSync(body)),
    deleteFile: async () => {},
    listFiles: async () => [],
  };
}

const run = laps => ({
  session: {
    id: 's1',
    ownerId: 'o',
    sim: 'lmu',
    sessionType: 'Practice',
    race: null,
    field: null,
    slices: null,
    fuel: null,
    result: null,
    classLaps: null,
    classBests: null,
  },
  recordings: [],
  laps,
  lapWindows: [],
  files: [],
  traces: [],
  band: null,
  slices: null,
  track: null,
  boundaries: null,
});

const lap = (n, extra = {}) => ({
  id: `s1-${n}`,
  sessionId: 's1',
  ownerId: 'o',
  lapNumber: n,
  lapTime: 100 + n,
  ...extra,
});

test('a second run writes only the lap that is new', async () => {
  const backend = stubBackend();
  const store = createStore(backend);
  await store.upload(run([lap(1), lap(2)]));
  assert.deepEqual(backend.lapWrites, ['s1-1', 's1-2']);
  backend.lapWrites.length = 0;
  await store.upload(run([lap(1), lap(2), lap(3)]));
  assert.deepEqual(backend.lapWrites, ['s1-3']);
});

test('a lap whose payload changed is written again, and only that one', async () => {
  const backend = stubBackend();
  const store = createStore(backend);
  await store.upload(run([lap(1), lap(2)]));
  backend.lapWrites.length = 0;
  await store.upload(run([lap(1, {comparable: false}), lap(2)]));
  assert.deepEqual(backend.lapWrites, ['s1-1']);
});

test('a lap doc that is gone is written again though its hash matches', async () => {
  const backend = stubBackend();
  const store = createStore(backend);
  await store.upload(run([lap(1), lap(2)]));
  backend.present.delete('s1-2');
  backend.lapWrites.length = 0;
  await store.upload(run([lap(1), lap(2)]));
  assert.deepEqual(backend.lapWrites, ['s1-2']);
});

test('a lap another writer tombstoned (heal, supersede) is written again', async () => {
  const backend = stubBackend();
  const store = createStore(backend);
  await store.upload(run([lap(1), lap(2)]));
  await backend.writeDocs([
    {
      op: 'set',
      coll: 'laps',
      id: 's1-2',
      data: {ownerId: 'o', supersededBy: 'x'},
      merge: true,
    },
  ]);
  backend.lapWrites.length = 0;
  await store.upload(run([lap(1), lap(2)]));
  assert.deepEqual(backend.lapWrites, ['s1-2']);
});

test('the hashes sit in a file beside the session, never on the session doc', async () => {
  const backend = stubBackend();
  await createStore(backend).upload(run([lap(1), lap(2)]));
  assert.equal(backend.docs.get('sessions/s1').lapHashes, undefined);
  const gz = backend.files.get('inputs/o/s1/lapHashes.json.gz');
  assert.deepEqual(JSON.parse(gunzipSync(gz).toString('utf8')), {
    's1-1': lapHash(lap(1)),
    's1-2': lapHash(lap(2)),
  });
});

test('a session stored before hashes existed writes every lap once', async () => {
  const backend = stubBackend({id: 's1', ownerId: 'o'}, ['s1-1', 's1-2']);
  await createStore(backend).upload(run([lap(1), lap(2)]));
  assert.deepEqual(backend.lapWrites, ['s1-1', 's1-2']);
});
