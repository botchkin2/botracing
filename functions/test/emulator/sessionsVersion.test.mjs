// GET /sessions and /sessions/facets against the real function in the Firebase
// emulators: the list carries a version, and a client holding it (`?v=`) gets
// {unchanged: true} and no session until a session is written, added or
// removed (roadmap 2w: the list read every session on each call). Run through
// `npm run test:emulator` in functions/.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test, before} from 'node:test';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-botracing';
const API = `http://127.0.0.1:5101/${PROJECT}/us-central1/dataApi`;
admin.initializeApp({projectId: PROJECT});

let idToken;
let uid;
let n = 0; // each write gets its own stamp: the list and facets tests share the docs
const db = () => admin.firestore();
const stamp = i => new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString();
const session = (i, extra = {}) => ({
  ownerId: uid,
  sim: 'lmu',
  trackId: 'lmu-spa',
  track: {name: 'Spa', variant: ''},
  startedAt: new Date(Date.now() - i * 3600_000).toISOString(),
  changedAt: stamp(i),
  ...extra,
});
const get = path =>
  fetch(`${API}${path}`, {headers: {authorization: `Bearer ${idToken}`}});

before(async () => {
  for (const host of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'])
    assert.ok(
      process.env[host],
      `${host} is not set: run through the emulators`,
    );
  const res = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        email: 'version@example.com',
        password: 'secret12',
        returnSecureToken: true,
      }),
    },
  );
  const body = await res.json();
  idToken = body.idToken;
  uid = body.localId;
  const batch = db().batch();
  for (let i = 0; i < 170; i++)
    batch.set(db().doc(`sessions/v${String(i).padStart(3, '0')}`), session(i));
  batch.set(
    db().doc('sessions/other-owner'),
    session(0, {ownerId: 'someone-else', changedAt: stamp(999)}),
  );
  await batch.commit();
});

for (const [name, path] of [
  ['list', '/sessions?age=3650'],
  ['facets', '/sessions/facets'],
]) {
  const asking = (v = '') => `${path}${path.includes('?') ? '&' : '?'}v=${v}`;
  test(`${name}: a version, and {unchanged} for a client holding it`, async () => {
    const first = await (await get(path)).json();
    assert.match(first.version, /^[0-9a-f]{16}$/);
    const again = await get(asking(first.version));
    const text = await again.text();
    assert.deepEqual(JSON.parse(text), {
      unchanged: true,
      version: first.version,
    });
    assert.ok(text.length < 100, `${text.length} bytes, not 170 sessions`);
    const wrong = await (await get(asking('0000000000000000'))).json();
    assert.equal(wrong.version, first.version);
    assert.ok(!wrong.unchanged);
  });

  test(`${name}: a session written, added or removed moves the version; another owner's does not`, async () => {
    const v0 = (await (await get(path)).json()).version;
    await db()
      .doc('sessions/other-owner')
      .set(session(0, {ownerId: 'someone-else', changedAt: stamp(5000)}));
    assert.equal((await (await get(path)).json()).version, v0, 'another owner');
    await db()
      .doc('sessions/v000')
      .update({changedAt: stamp(3000 + (n += 1))});
    const v1 = (await (await get(path)).json()).version;
    assert.notEqual(v1, v0, 'a write');
    await db()
      .doc('sessions/v-new')
      .set(session(1, {changedAt: stamp(1)}));
    const v2 = (await (await get(path)).json()).version;
    assert.notEqual(v2, v1, 'an added session');
    await db().doc('sessions/v-new').delete();
    const v3 = (await (await get(path)).json()).version;
    assert.notEqual(v3, v2, 'a removed session');
  });
}

test('the list holds all 170 sessions and says the version beside them', async () => {
  const body = await (await get('/sessions?age=3650')).json();
  assert.equal(body.items.length, 170);
  assert.equal(body.total, 170);
});
