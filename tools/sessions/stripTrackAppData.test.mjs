import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  DELETE,
  boundaryUserRefPatch,
  fieldValueFrom,
  stripTrackAppData,
  trackUserRefPatch,
} from './stripTrackAppData.mjs';

function fakeDb(writes) {
  const docs = rows => ({
    docs: rows.map(([id, data]) => ({
      id,
      data: () => data,
      ref: {update: async patch => writes.push([id, patch])},
    })),
  });
  return {
    collection: name => ({
      get: async () =>
        docs(
          name === 'tracks'
            ? [['lmu-road', {ownerId: 'botkin', name: 'Road Atlanta'}]]
            : [['lmu-road', {v: 2, sessions: {s1: []}}]],
        ),
    }),
  };
}

test('a track doc loses its owner, session list, session id and surface session count', () => {
  const patch = trackUserRefPatch({
    id: 'lmu-road',
    ownerId: 'botkin',
    name: 'Road Atlanta',
    sessions: ['s1', 's2'],
    source: {sessionId: 's1', builtAt: '2026-09-20T00:00:00Z'},
    surface: {path: 'surface/lmu-road/v1.json.gz', sessions: 2, bins: 400},
    corners: [1],
  });
  assert.equal(patch.ownerId, DELETE);
  assert.equal(patch.sessions, DELETE);
  // builtAt is not a user reference, so source stays and only the id goes.
  assert.deepEqual(patch.source, {builtAt: '2026-09-20T00:00:00Z'});
  assert.deepEqual(patch.surface, {
    path: 'surface/lmu-road/v1.json.gz',
    bins: 400,
  });
  assert.equal('corners' in patch, false);
});

test('a source with only a session id is deleted, other source fields stay', () => {
  const kept = trackUserRefPatch({
    source: {sessionId: 's1', note: 'hand fit'},
  });
  assert.deepEqual(kept.source, {note: 'hand fit'});
  assert.equal(
    trackUserRefPatch({source: {sessionId: 's1'}}).source,
    DELETE,
  );
  assert.deepEqual(trackUserRefPatch({name: 'Road Atlanta'}), {});
});

test('boundary docs lose the session map and nothing else', () => {
  assert.deepEqual(
    boundaryUserRefPatch({v: 2, rev: 4, startsM: [10], sessions: {s1: []}}),
    {sessions: DELETE},
  );
  assert.deepEqual(boundaryUserRefPatch({v: 2, rev: 4}), {});
});

test('--apply without FieldValue writes nothing', async () => {
  const writes = [];
  await assert.rejects(
    () => stripTrackAppData({db: fakeDb(writes), apply: true, log: () => {}}),
    /FieldValue\.delete is missing/,
  );
  assert.deepEqual(writes, []);
});

test('the apply path deletes with admin.firestore.FieldValue', async () => {
  const writes = [];
  function firestore() {
    return {};
  }
  firestore.FieldValue = {delete: () => 'DEL'};
  const FieldValue = fieldValueFrom({firestore});
  await stripTrackAppData({
    db: fakeDb(writes),
    FieldValue,
    apply: true,
    log: () => {},
  });
  assert.deepEqual(writes, [
    ['lmu-road', {ownerId: 'DEL'}],
    ['lmu-road', {sessions: 'DEL'}],
  ]);
});

test('the dry run lists the documents and writes nothing; --apply writes', async () => {
  const writes = [];
  const db = fakeDb(writes);
  const FieldValue = {delete: () => 'DEL'};
  const dry = await stripTrackAppData({db, FieldValue, log: () => {}});
  assert.deepEqual(writes, []);
  assert.match(dry.join('\n'), /tracks\/lmu-road: delete ownerId/);
  assert.match(dry.join('\n'), /trackBoundaries\/lmu-road: delete sessions/);
  assert.match(dry.join('\n'), /dry-run: 2 document/);

  const applied = await stripTrackAppData({
    db,
    FieldValue,
    apply: true,
    log: () => {},
  });
  assert.deepEqual(writes, [
    ['lmu-road', {ownerId: 'DEL'}],
    ['lmu-road', {sessions: 'DEL'}],
  ]);
  assert.match(applied.join('\n'), /applied 2 document/);
});
