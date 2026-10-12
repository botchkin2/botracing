// Real requests against the deployed shape of the API, in the Firebase
// emulators (functions, Firestore, Auth, Storage): the track-by-id routes
// (pit-wall thread 1 #3479/#3529). Run through `npm run test:emulator` in
// functions/, which starts the emulators and sets their *_EMULATOR_HOST vars.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test, before} from 'node:test';
import {gzipSync, gunzipSync} from 'node:zlib';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-botracing';
const API = `http://127.0.0.1:5101/${PROJECT}/us-central1/lmuApi`;
const BUCKET = 'botracing-61-lmu';
const TRACK = 'lmu-test_ring';

admin.initializeApp({projectId: PROJECT, storageBucket: BUCKET});

const surface = {v: 1, stepM: 10, lengthM: 400, sessions: ['s1'], bins: []};
const outline = {type: 'FeatureCollection', features: []};
let idToken;

before(async () => {
  for (const host of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'])
    assert.ok(process.env[host], `${host} is not set: run through the emulators`);
  const bucket = admin.storage().bucket(BUCKET);
  await bucket.file(`trackmaps/${TRACK}/v1.geojson`).save(JSON.stringify(outline));
  await bucket.file(`surface/${TRACK}/v1.json.gz`).save(gzipSync(JSON.stringify(surface)), {
    metadata: {contentEncoding: 'gzip', contentType: 'application/json'},
  });
  await admin.firestore().doc(`tracks/${TRACK}`).set({
    track: 'Test Ring',
    lengthM: 400,
    corners: [{n: 1, apexM: 100}],
    quality: 'good',
    outline: {path: `trackmaps/${TRACK}/v1.geojson`, attribution: 'OSM'},
    surface: {path: `surface/${TRACK}/v1.json.gz`, updatedAt: '2026-10-10T00:00:00.000Z', laps: 12},
  });
  // A signed-in user of the Auth emulator: a real ID token the API verifies.
  const res = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({email: 'driver@example.com', password: 'secret12', returnSecureToken: true}),
    },
  );
  idToken = (await res.json()).idToken;
  assert.ok(idToken, 'no ID token from the Auth emulator');
});

const get = (path, headers = {}) =>
  fetch(`${API}${path}`, {headers: {authorization: `Bearer ${idToken}`, ...headers}});

test('signed in: the map by track id, with its validator and the surface revision', async () => {
  const res = await get(`/tracks/${TRACK}/map`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('etag') ?? '', /^"m-\d+\.\d+"$/);
  assert.equal(res.headers.get('cache-control'), 'private, max-age=3600');
  const body = await res.json();
  assert.equal(body.trackId, TRACK);
  assert.deepEqual(body.corners, [{n: 1, apexM: 100}]);
  assert.deepEqual(body.outline, outline);
  assert.equal(body.surfaceRev, '"s-2026-10-10T00:00:00.000Z-12"');
});

test('signed in: the surface by track id, the stored bytes, ETag = surfaceRev', async () => {
  const res = await get(`/tracks/${TRACK}/surface`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('etag'), '"s-2026-10-10T00:00:00.000Z-12"');
  assert.equal(res.headers.get('cache-control'), 'private, max-age=300');
  // fetch undoes the gzip Content-Encoding; the JSON is the stored surface.
  const text = Buffer.from(await res.arrayBuffer());
  const json = JSON.parse(text[0] === 0x1f ? gunzipSync(text).toString() : text.toString());
  assert.deepEqual(json, surface);
});

test('a client holding the validator gets a 304 with no body, on both', async () => {
  for (const part of ['map', 'surface']) {
    const first = await get(`/tracks/${TRACK}/${part}`);
    const etag = first.headers.get('etag');
    await first.arrayBuffer();
    const again = await get(`/tracks/${TRACK}/${part}`, {'if-none-match': etag});
    assert.equal(again.status, 304, part);
    assert.equal((await again.arrayBuffer()).byteLength, 0, part);
    const stale = await get(`/tracks/${TRACK}/${part}`, {'if-none-match': '"m-0.0"'});
    assert.equal(stale.status, 200, part);
    await stale.arrayBuffer();
  }
});

test('signed out: 401, whatever the track', async () => {
  const res = await fetch(`${API}/tracks/${TRACK}/map`);
  assert.equal(res.status, 401);
});

test('an unknown or malformed id: 404 (it does not exist)', async () => {
  for (const id of ['lmu-no_such_track', 'LMU-Bad', 'lmu-monza..x', 'x']) {
    const res = await get(`/tracks/${encodeURIComponent(id)}/map`);
    assert.equal(res.status, 404, id);
    await res.arrayBuffer();
  }
  // A layout with no surface yet: the map is there, the surface is not.
  await admin.firestore().doc('tracks/lmu-new_layout').set({track: 'New', lengthM: 1000, corners: []});
  assert.equal((await get('/tracks/lmu-new_layout/map')).status, 200);
  assert.equal((await get('/tracks/lmu-new_layout/surface')).status, 404);
});
