// GET /plan against the real function in the Firebase emulators (functions,
// Firestore, Auth): one projection query for a track and car, newest first,
// the owner's sessions only, small. Run through `npm run test:emulator` in
// functions/ (pit-wall thread 1 #3485, #3487).
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test, before} from 'node:test';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-botracing';
const API = `http://127.0.0.1:5101/${PROJECT}/us-central1/lmuApi`;
admin.initializeApp({projectId: PROJECT});

const COMBO = 'sim=iracing&trackId=iracing-127-full&car=Ford%20Mustang%20GT3';
let idToken;
let uid;

const laps = n =>
  Array.from({length: n}, (_, i) => ({n: i + 1, usedL: 2.4, veUsedPct: null, timeS: 90, comparable: true, traffic: null}));
const plan = {
  v: 1,
  fuel: {fillLimitL: 60, startL: 60, tankL: 105, litresPerVePct: null},
  laps: laps(100),
  race: null,
};
const when = i => new Date(Date.UTC(2026, 9, 9) - i * 86400000).toISOString();

before(async () => {
  for (const host of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'])
    assert.ok(process.env[host], `${host} is not set: run through the emulators`);
  const res = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({email: 'plan@example.com', password: 'secret12', returnSecureToken: true}),
    },
  );
  const body = await res.json();
  idToken = body.idToken;
  uid = body.localId;
  assert.ok(idToken && uid, 'no user from the Auth emulator');

  const base = {ownerId: uid, sim: 'iracing', trackId: 'iracing-127-full', carModel: 'Ford Mustang GT3', sessionType: 'Practice'};
  const db = admin.firestore();
  const batch = db.batch();
  // The combo: 100 sessions with 100 laps each, and fields the Plan must not get.
  for (let i = 0; i < 100; i++)
    batch.set(db.doc(`sessions/c${String(i).padStart(3, '0')}`), {
      ...base, startedAt: when(i), plan, consistency: {overview: 'x'.repeat(2000)}, lapTable: laps(100),
    });
  // Not the combo: another owner, sim, car and track.
  batch.set(db.doc('sessions/other-owner'), {...base, ownerId: 'someone-else', startedAt: when(0), plan});
  batch.set(db.doc('sessions/other-sim'), {...base, sim: 'lmu', startedAt: when(0), plan});
  batch.set(db.doc('sessions/other-car'), {...base, carModel: 'Porsche 911 GT3 R', startedAt: when(0), plan});
  batch.set(db.doc('sessions/other-track'), {...base, trackId: 'iracing-9-gp', startedAt: when(0), plan});
  // Uploaded before the block existed.
  batch.set(db.doc('sessions/old'), {...base, startedAt: when(200)});
  await batch.commit();
});

const get = (path, headers = {}) =>
  fetch(`${API}${path}`, {headers: {authorization: `Bearer ${idToken}`, ...headers}});

test('a 101-session combo comes back in one request: newest first, only its own, small', async () => {
  const res = await get(`/plan?${COMBO}`);
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.truncated, false);
  assert.equal(body.items.length, 101, '100 with a block and the old one');
  assert.deepEqual(body.items.slice(0, 3).map(r => r.id), ['c000', 'c001', 'c002']);
  assert.equal(body.items.at(-1).id, 'old');
  assert.equal(body.items.at(-1).plan, null, 'no block = null, not zero');
  assert.equal(body.items.filter(r => r.plan?.laps).length, 8, 'laps for the newest 8 only');
  assert.ok(!body.items.some(r => r.id.startsWith('other')), 'nothing of another owner, sim, car or track');
  for (const r of body.items) assert.deepEqual(Object.keys(r).sort(), ['id', 'plan', 'sessionType', 'startedAt']);
  assert.ok(text.length < 130_000, `${text.length} bytes for a 101-session combo`);
});

test('laps= sets how many of the newest keep their lap rows', async () => {
  const body = await (await get(`/plan?${COMBO}&laps=2`)).json();
  assert.equal(body.items.filter(r => r.plan?.laps).length, 2);
});

test('the response is private and revalidated: Cache-Control, an ETag, a 304 on the same validator', async () => {
  const first = await get(`/plan?${COMBO}`);
  console.log('plan route headers:', first.headers.get('cache-control'), first.headers.get('etag'));
  await first.arrayBuffer();
  assert.equal(first.headers.get('cache-control'), 'private, max-age=60');
  const etag = first.headers.get('etag');
  assert.ok(etag, 'an ETag, so a warm open revalidates instead of downloading');
  const again = await get(`/plan?${COMBO}`, {'if-none-match': etag});
  assert.equal(again.status, 304);
  assert.equal((await again.arrayBuffer()).byteLength, 0);
  const stale = await get(`/plan?${COMBO}`, {'if-none-match': '"p-0"'});
  assert.equal(stale.status, 200);
  await stale.arrayBuffer();
});

test('a bad or missing parameter is a 400 that says which; signed out is a 401', async () => {
  const cases = [
    ['sim=acc&trackId=t&car=c', /sim must be/],
    ['sim=lmu&car=c', /trackId is required/],
    ['sim=lmu&trackId=t', /car is required/],
  ];
  for (const [q, message] of cases) {
    const res = await get(`/plan?${q}`);
    assert.equal(res.status, 400, q);
    assert.match((await res.json()).error, message);
  }
  assert.equal((await fetch(`${API}/plan?${COMBO}`)).status, 401);
});

test('a combo with no sessions is an empty list, not an error', async () => {
  const body = await (await get('/plan?sim=lmu&trackId=lmu-none&car=Nothing')).json();
  assert.deepEqual(body, {items: [], truncated: false});
});
