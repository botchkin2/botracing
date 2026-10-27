// GET /me against the real function in the Firebase emulators (pit-wall thread
// 112 #7981): the flags of the caller's own users doc and nothing else. No
// token is 401; a doc without the field is false; a doc with `canSendNote: true`
// is true; another uid's flag never reaches this caller. Run through
// `npm run test:emulator` in functions/.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {before, test} from 'node:test';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-botracing';
const API = `http://127.0.0.1:5101/${PROJECT}/us-central1/dataApi`;
admin.initializeApp({projectId: PROJECT});

const db = () => admin.firestore();
const users = {};

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
  return {idToken: body.idToken, uid: body.localId};
}
const me = who =>
  fetch(`${API}/me`, {
    headers: who ? {authorization: `Bearer ${users[who].idToken}`} : {},
  });

before(async () => {
  for (const host of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'])
    assert.ok(process.env[host], `${host} is not set: run through the emulators`);
  users.plain = await signUp('plain@example.com');
  users.noted = await signUp('noted@example.com');
  users.stranger = await signUp('stranger@example.com');
  await db().doc(`users/${users.noted.uid}`).set({canSendNote: true, ownerKey: 'k'});
  await db().doc(`users/${users.plain.uid}`).set({ownerKey: 'p'});
});

test('no token is 401', async () => {
  assert.equal((await me(null)).status, 401);
});

test('a user doc without the field reads false', async () => {
  const res = await me('plain');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {canSendNote: false});
});

test('a user with no doc at all reads false', async () => {
  assert.deepEqual(await (await me('stranger')).json(), {canSendNote: false});
});

test('a user with the flag reads true, and only the flag comes back', async () => {
  assert.deepEqual(await (await me('noted')).json(), {canSendNote: true});
});

test("another uid's flag never reaches this caller, whatever the query says", async () => {
  const res = await fetch(`${API}/me?uid=${users.noted.uid}`, {
    headers: {authorization: `Bearer ${users.plain.idToken}`},
  });
  assert.deepEqual(await res.json(), {canSendNote: false});
});
