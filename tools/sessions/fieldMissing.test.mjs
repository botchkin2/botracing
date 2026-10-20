// Run: node --test tools/sessions/fieldMissing.test.mjs
// Every session without a field says why (pit wall thread 95, the Sebring
// practice of 2026-10-19 that had none and nobody was told).
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fieldMissingAfter, fieldMissingText} from './field.mjs';
import {createStore} from './store.mjs';

test('every reason has a plain line, and an unknown one says not recorded', () => {
  for (const reason of [
    'no capture',
    'capture marked suspect',
    'capture game data not recognised',
    'capture has no rows in this session',
    'clocks disagree: player 31.0 m apart',
    'player car not in both sources',
    null,
  ]) {
    const text = fieldMissingText(reason);
    assert.ok(text.length > 20 && !/capture|mID|lap distance/.test(text), text);
  }
  // Not verdicts: a live lap that could not make a field, iRacing's from the game file.
  assert.equal(fieldMissingText('iRacing: from the game file'), null);
  assert.equal(fieldMissingText('boom'), null);
  assert.equal(fieldMissingAfter(null, 'boom', undefined), null);
  assert.equal(fieldMissingAfter(null, 'boom', 'stored line'), 'stored line');
  assert.match(fieldMissingText('no capture'), /not recorded/);
  assert.match(fieldMissingText('capture marked suspect'), /doubted/);
});

test('fieldMissingAfter: none with a field; a run without a reason keeps the stored line', () => {
  assert.equal(fieldMissingAfter({path: 'p'}, 'no capture', 'old'), null);
  assert.equal(fieldMissingAfter(null, 'no capture', 'old'), fieldMissingText('no capture'));
  assert.equal(fieldMissingAfter(null, undefined, 'stored line'), 'stored line');
  assert.equal(fieldMissingAfter(null, undefined, undefined), fieldMissingText(null));
});

function memory(before) {
  const docs = new Map(before ? [['sessions/s1', before]] : []);
  return {
    docs,
    getDoc: async (coll, id) => docs.get(`${coll}/${id}`) ?? null,
    writeDocs: async ops => {
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

const outOf = (field, fieldReason) => ({
  session: {id: 's1', ownerId: 'o', sim: 'lmu', sessionType: 'Practice', field, race: null, slices: null, fuel: null, result: null},
  recordings: [],
  laps: [],
  lapWindows: [],
  files: [],
  traces: [],
  band: null,
  slices: null,
  track: null,
  boundaries: null,
  fieldReason,
});

test('a session built from a game file with no capture is stamped, and the cloud keeps the stamp', async () => {
  const b = memory();
  await createStore(b).upload(outOf(null, 'no capture'));
  assert.equal(b.docs.get('sessions/s1').fieldMissing, fieldMissingText('no capture'));
  // A later cloud run has no capture to read: no reason, the stored line stays.
  await createStore(b).upload(outOf(null, undefined));
  assert.equal(b.docs.get('sessions/s1').fieldMissing, fieldMissingText('no capture'));
});

test('a session with a field carries no stamp, and a later run without one keeps the field and no stamp', async () => {
  const stored = {path: 'field/o/s1/h.json.gz', hash: 'h', cars: 5};
  const b = memory({id: 's1', field: stored});
  await createStore(b).upload(outOf(null, 'no capture'));
  const doc = b.docs.get('sessions/s1');
  assert.equal(doc.field.hash, 'h');
  assert.equal(doc.fieldMissing, null);
});
