// Run: node --test tools/sessions/lapWriteSkip.test.mjs
// A live session is analysed again on every lap (pit wall thread 101, #38):
// a lap doc that comes out the same is not written again, and one that
// changed, or whose doc is gone, is. The hash sits on the lap doc itself.
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {createStore, lapHash} from './store.mjs';

// Like adminBackend: a lap with `supersededBy` is not among the session's laps.
function stubBackend({withHashes = true} = {}) {
  const docs = new Map();
  const lapWrites = [];
  const backend = {
    docs,
    lapWrites,
    failLapWrites: false,
    getDoc: async (coll, id) => docs.get(`${coll}/${id}`) ?? null,
    writeDocs: async ops => {
      for (const op of ops) {
        const key = `${op.coll}/${op.id}`;
        if (op.op === 'delete') {
          docs.delete(key);
          continue;
        }
        if (op.coll === 'laps' && !op.merge) {
          if (backend.failLapWrites) throw new Error('crash');
          lapWrites.push(op.id);
        }
        docs.set(key, op.merge ? {...docs.get(key), ...op.data} : op.data);
      }
    },
    getFile: async () => null,
    sessionLapIds: async () => lapDocs().map(([id]) => id),
    fileMd5: async () => null,
    putFile: async () => {},
    deleteFile: async () => {},
    listFiles: async () => [],
  };
  const lapDocs = () =>
    [...docs]
      .filter(([k, v]) => k.startsWith('laps/') && !v.supersededBy)
      .map(([k, v]) => [k.slice(5), v]);
  if (withHashes)
    backend.sessionLapHashes = async () =>
      Object.fromEntries(
        lapDocs().map(([id, v]) => [id, v.payloadHash ?? null]),
      );
  return backend;
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

test('the hash is stored on the lap doc, in the same write as the payload', async () => {
  const backend = stubBackend();
  await createStore(backend).upload(run([lap(1)]));
  const doc = backend.docs.get('laps/s1-1');
  assert.equal(doc.payloadHash, lapHash(lap(1)));
  assert.equal(doc.lapTime, 101);
});

test('a lap doc that is gone is written again', async () => {
  const backend = stubBackend();
  const store = createStore(backend);
  await store.upload(run([lap(1), lap(2)]));
  backend.docs.delete('laps/s1-2');
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

test('a lap doc from before hashes existed is written once', async () => {
  const backend = stubBackend();
  backend.docs.set('laps/s1-1', lap(1));
  await createStore(backend).upload(run([lap(1)]));
  assert.deepEqual(backend.lapWrites, ['s1-1']);
});

test('a crash before a lap write leaves that lap with its old hash and payload (A, B, crash, A)', async () => {
  const backend = stubBackend();
  const store = createStore(backend);
  await store.upload(run([lap(1)]));
  backend.failLapWrites = true;
  await assert.rejects(
    store.upload(run([lap(1, {comparable: false})])),
    /crash/,
  );
  backend.failLapWrites = false;
  backend.lapWrites.length = 0;
  // Doc and hash are one write: the stored hash still names the stored
  // payload (A), so A again is a correct skip.
  await store.upload(run([lap(1)]));
  assert.deepEqual(backend.lapWrites, []);
  assert.equal(backend.docs.get('laps/s1-1').lapTime, 101);
  assert.equal(backend.docs.get('laps/s1-1').comparable, undefined);
});

test('a backend that cannot read the hashes (the tray HTTP one) writes every lap', async () => {
  const backend = stubBackend({withHashes: false});
  const store = createStore(backend);
  await store.upload(run([lap(1), lap(2)]));
  backend.lapWrites.length = 0;
  await store.upload(run([lap(1), lap(2)]));
  assert.deepEqual(backend.lapWrites, ['s1-1', 's1-2']);
});
