// GET and PUT /api/fuel-presets against the real function in the Firebase emulators
// (functions, Firestore, Auth): the stored doc, the version check, the 409 with the
// current list, an owner's list apart from another's, and the sign-in. Run through
// `npm run test:emulator` in functions/ (pit-wall thread 104, B2).
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {before, test} from 'node:test';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-botracing';
const API = `http://127.0.0.1:5101/${PROJECT}/us-central1/fuelPresetsApi`;
admin.initializeApp({projectId: PROJECT});

const preset = (id, over = {}) => ({
  id,
  name: `Rules ${id}`,
  length: {kind: 'min', value: 60},
  fuelL: 73,
  vePct: 100,
  veRatio: null,
  formationLap: true,
  mandatoryStops: 0,
  savedAt: new Date().toISOString(),
  ...over,
});

let phone;
let pc;
let stranger;

async function signUp(email) {
  const res = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({email, password: 'secret12', returnSecureToken: true}),
    },
  );
  const body = await res.json();
  assert.ok(body.idToken, `no user from the Auth emulator for ${email}`);
  return {token: body.idToken, uid: body.localId};
}

const call = (who, method, body) =>
  fetch(API, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(who ? {authorization: `Bearer ${who.token}`} : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

before(async () => {
  for (const host of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'])
    assert.ok(process.env[host], `${host} is not set: run through the emulators`);
  phone = await signUp('presets-phone@example.com');
  stranger = await signUp('presets-stranger@example.com');
  // The same person signed in on the PC with another account: one owner key, one list.
  pc = await signUp('presets-pc@example.com');
  await admin.firestore().doc(`users/${phone.uid}`).set({ownerKey: 'one-driver'});
  await admin.firestore().doc(`users/${pc.uid}`).set({ownerKey: 'one-driver'});
});

test('a first read is an empty list at version 0', async () => {
  const res = await call(phone, 'GET');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), {presets: [], removed: {}, version: 0, updatedAt: null});
});

test('a write is stored under the owner key and the other sign-in of the same person reads it', async () => {
  const put = await call(phone, 'PUT', {presets: [preset('p1')], removed: {}, baseVersion: 0});
  assert.equal(put.status, 200);
  const written = await put.json();
  assert.equal(written.version, 1);
  const doc = (await admin.firestore().doc('fuelPresets/one-driver').get()).data();
  assert.equal(doc.version, 1);
  assert.equal(doc.presets[0].id, 'p1');
  const fromPc = await (await call(pc, 'GET')).json();
  assert.equal(fromPc.version, 1);
  assert.equal(fromPc.presets[0].name, 'Rules p1');
});

test('a write built on an old version is refused with 409 and the current list; it stores nothing', async () => {
  const stale = await call(pc, 'PUT', {presets: [preset('pc-only')], removed: {}, baseVersion: 0});
  assert.equal(stale.status, 409);
  const current = await stale.json();
  assert.equal(current.version, 1);
  assert.deepEqual(
    current.presets.map(p => p.id),
    ['p1'],
  );
  const doc = (await admin.firestore().doc('fuelPresets/one-driver').get()).data();
  assert.deepEqual(
    doc.presets.map(p => p.id),
    ['p1'],
  );
  // the retry on the version it was just given is accepted
  const retry = await call(pc, 'PUT', {
    presets: [...current.presets, preset('pc-only')],
    removed: {},
    baseVersion: current.version,
  });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).version, 2);
});

test('a removed preset leaves a tombstone, and another owner never sees any of it', async () => {
  const gone = new Date().toISOString();
  const put = await call(phone, 'PUT', {presets: [preset('p1')], removed: {'pc-only': gone}, baseVersion: 2});
  assert.equal(put.status, 200);
  assert.deepEqual((await put.json()).removed, {'pc-only': gone});
  const other = await (await call(stranger, 'GET')).json();
  assert.deepEqual(other, {presets: [], removed: {}, version: 0, updatedAt: null});
});

test('a bad body is a 400 and stores nothing; no sign-in is a 401; other methods are 405', async () => {
  const bad = await call(phone, 'PUT', {presets: [preset('p1', {name: ''})], removed: {}, baseVersion: 3});
  assert.equal(bad.status, 400);
  assert.equal((await call(null, 'GET')).status, 401);
  assert.equal((await call({token: 'garbage'}, 'GET')).status, 401);
  assert.equal((await call(phone, 'DELETE')).status, 405);
  const doc = (await admin.firestore().doc('fuelPresets/one-driver').get()).data();
  assert.equal(doc.version, 3);
});
