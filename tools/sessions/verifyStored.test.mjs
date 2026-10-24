import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifyStored} from './verifyStored.mjs';

// A backend holding docs by "collection/id", the session's lap ids and the
// bucket's files: the three things a read-back looks at.
function backend({sessions = {}, laps = {}, files = []} = {}) {
  return {
    getDoc: async (coll, id) =>
      coll === 'sessions' ? sessions[id] ?? null : null,
    sessionLapIds: async id => laps[id] ?? [],
    fileMd5: async dest => (files.includes(dest) ? 'md5' : null),
  };
}

const FIELD = {path: 'field/o/s1/abc.json.gz', hash: 'abc'};
const built = (field = FIELD) => ({
  session: {id: 's1', field},
  laps: [{id: 's1-1'}, {id: 's1-2'}],
});
const stored = (field = FIELD) =>
  backend({
    sessions: {s1: {id: 's1', field}},
    laps: {s1: ['s1-1', 's1-2']},
    files: [FIELD.path],
  });

test('a session stored whole, with its field, is verified', async () => {
  assert.deepEqual(await verifyStored(stored(), built()), {
    ok: true,
    sessionId: 's1',
    laps: 2,
    fieldHash: 'abc',
  });
});

test('a session that is not in the store is not verified', async () => {
  const r = await verifyStored(backend(), built());
  assert.equal(r.ok, false);
  assert.match(r.reason, /not in the store/);
});

test('a lap the build made and the store lacks fails it', async () => {
  const b = stored();
  b.sessionLapIds = async () => ['s1-1'];
  const r = await verifyStored(b, built());
  assert.equal(r.ok, false);
  assert.match(r.reason, /1 of 2 laps not stored \(first s1-2\)/);
});

test('no field stored, or its file missing from the bucket, fails it: the capture is the only copy', async () => {
  const none = await verifyStored(stored(null), built(null));
  assert.equal(none.ok, false);
  assert.match(none.reason, /has no field/);
  const b = stored();
  b.fileMd5 = async () => null;
  const gone = await verifyStored(b, built());
  assert.equal(gone.ok, false);
  assert.match(gone.reason, /not in the bucket/);
});

test('a smaller field kept aside verifies when that file is in the bucket', async () => {
  const richer = {
    path: 'field/o/s1/old.json.gz',
    hash: 'old',
    mark: {kind: 'smaller', aside: FIELD.path},
  };
  const b = backend({
    sessions: {s1: {id: 's1', field: richer}},
    laps: {s1: ['s1-1', 's1-2']},
    files: [richer.path, FIELD.path],
  });
  assert.deepEqual(await verifyStored(b, built()), {
    ok: true,
    sessionId: 's1',
    laps: 2,
    fieldHash: 'old',
  });
  b.fileMd5 = async dest => (dest === richer.path ? 'md5' : null);
  const gone = await verifyStored(b, built());
  assert.equal(gone.ok, false);
  assert.match(gone.reason, /stored field old is not the uploaded abc/);
});

test('a stored field that is not the one uploaded fails it, unless the upload was skipped', async () => {
  const other = {path: FIELD.path, hash: 'old'};
  const r = await verifyStored(stored(other), built());
  assert.equal(r.ok, false);
  assert.match(r.reason, /stored field old is not the uploaded abc/);
  // The cloud's analysis was newer: its own field stands.
  const skipped = await verifyStored(stored(other), built(), {
    skipped: 'newer',
  });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.fieldHash, 'old');
});

test('a session replaced by a heal is checked as its successor', async () => {
  const b = backend({
    sessions: {
      s1: {id: 's1', supersededBy: 's2'},
      s2: {id: 's2', field: FIELD},
    },
    laps: {s2: ['s2-1', 's2-2', 's2-3']},
    files: [FIELD.path],
  });
  assert.deepEqual(await verifyStored(b, built()), {
    ok: true,
    sessionId: 's2',
    laps: 3,
    fieldHash: 'abc',
  });
  b.sessionLapIds = async () => [];
  assert.equal((await verifyStored(b, built())).ok, false);
});

test('a session named without its build (an old marker) needs a lap and its field', async () => {
  assert.deepEqual(await verifyStored(stored(), null, {sessionId: 's1'}), {
    ok: true,
    sessionId: 's1',
    laps: 2,
    fieldHash: 'abc',
  });
  const noField = await verifyStored(stored(null), null, {sessionId: 's1'});
  assert.equal(noField.ok, false);
});
