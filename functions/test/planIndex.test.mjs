import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

// The emulator does not enforce composite indexes, so that the plan query's
// index exists is checked on the file (the deploy builds it).
test('the plan route\'s query has its index', () => {
  const file = JSON.parse(
    readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8'),
  );
  const want = ['ownerId', 'sim', 'trackId', 'carModel', 'startedAt'];
  const has = file.indexes.some(
    ix =>
      ix.collectionGroup === 'sessions' &&
      JSON.stringify(ix.fields.map(f => f.fieldPath)) === JSON.stringify(want) &&
      ix.fields.at(-1).order === 'DESCENDING' &&
      ix.fields.slice(0, -1).every(f => f.order === 'ASCENDING'),
  );
  assert.ok(has, 'sessions (ownerId, sim, trackId, carModel, startedAt desc) is in firestore.indexes.json');
});
