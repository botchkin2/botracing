// Against the Firestore emulator, with the real query (sessionStore.ts
// listPlanSessions). Skipped unless FIRESTORE_EMULATOR_HOST is set:
//
//   npx firebase-tools emulators:exec --only firestore --project demo-plan \
//     "node --test functions/test/planStore.emulator.test.mjs"
//
// The emulator does not enforce composite indexes, so that the index exists is
// checked on the file (firestore.indexes.json), not here.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const require = createRequire(new URL('../package.json', import.meta.url));

test('the plan query returns one combo of one owner, newest first, small', {skip: !emulator}, async () => {
  const admin = require('firebase-admin');
  admin.initializeApp({projectId: 'demo-plan'});
  const {listPlanSessions} = require('./lib/sessionStore.js');
  const db = admin.firestore();

  const laps = n =>
    Array.from({length: n}, (_, i) => ({n: i + 1, usedL: 2.4, veUsedPct: null, timeS: 90, comparable: true, traffic: null}));
  const plan = {v: 1, fuel: {fillLimitL: 60, startL: 60, tankL: 105, litresPerVePct: null}, laps: laps(100), race: null};
  const base = {ownerId: 'owner-a', sim: 'iracing', trackId: 'iracing-127-full', carModel: 'Ford Mustang GT3', sessionType: 'Practice'};
  const when = i => new Date(Date.UTC(2026, 9, 9) - i * 86400000).toISOString();

  const batch = db.batch();
  // The combo: 100 sessions, each with 100 laps, plus fields the Plan must not get.
  for (let i = 0; i < 100; i++)
    batch.set(db.doc(`sessions/c${String(i).padStart(3, '0')}`), {
      ...base, startedAt: when(i), plan, consistency: {overview: 'x'.repeat(2000)}, lapTable: laps(100),
    });
  // Not the combo: another owner, another sim, another car, another track.
  batch.set(db.doc('sessions/other-owner'), {...base, ownerId: 'owner-b', startedAt: when(0), plan});
  batch.set(db.doc('sessions/other-sim'), {...base, sim: 'lmu', startedAt: when(0), plan});
  batch.set(db.doc('sessions/other-car'), {...base, carModel: 'Porsche 911 GT3 R', startedAt: when(0), plan});
  batch.set(db.doc('sessions/other-track'), {...base, trackId: 'iracing-9-gp', startedAt: when(0), plan});
  // Uploaded before the block existed.
  batch.set(db.doc('sessions/old'), {...base, startedAt: when(200)});
  await batch.commit();

  const combo = {sim: 'iracing', trackId: 'iracing-127-full', carModel: 'Ford Mustang GT3'};
  const {items, truncated} = await listPlanSessions('owner-a', combo, 8);
  assert.equal(truncated, false);
  assert.equal(items.length, 101, '100 with a block and the old one');
  assert.deepEqual(items.slice(0, 3).map(r => r.id), ['c000', 'c001', 'c002'], 'newest first');
  assert.equal(items.at(-1).id, 'old');
  assert.equal(items.at(-1).plan, null);
  assert.equal(items.filter(r => r.plan?.laps).length, 8);
  assert.ok(!items.some(r => r.id.startsWith('other')), 'nothing of another owner, sim, car or track');
  for (const r of items) assert.deepEqual(Object.keys(r).sort(), ['id', 'plan', 'sessionType', 'startedAt']);
  const bytes = JSON.stringify({items}).length;
  assert.ok(bytes < 130_000, `${bytes} bytes for a 101-session combo`);
});

test('the combo query has its index', () => {
  const file = JSON.parse(readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8'));
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
