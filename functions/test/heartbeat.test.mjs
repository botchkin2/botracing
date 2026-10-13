// POST /heartbeat, on real tray payloads only (contract/README.md): every
// body is a payload a tray sent, or one field of one changed with mutate().
// The bodies the senders build are put through the same contract in
// tools/uploader/heartbeat.contract.test.mjs.
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {loadPayloads, mutate, payload} from '../../contract/payloads.mjs';
import {toUploader} from '../../src/data/uploaders/adapters.ts';

import {call, world} from './uploadWorld.mjs';

// The beat 0.1.9 sent while LMU recorded, refused then (#597, gameVersion 0).
const RECORDING = payload('heartbeat', '0.1.9-in-game-rec-recording');
const HOST = RECORDING.hostId;
const NOW0 = Date.parse('2026-10-13T04:00:00Z');
const clockWorld = () => {
  const w = world();
  w.clock = {t: NOW0};
  w.deps.now = () => w.clock.t;
  return w;
};
const send = (w, token, body) =>
  call(w, token, 'POST', '/heartbeat', {json: body});
const stored = (w, uid = 'uidA', host = HOST) =>
  w.docs.get(`uploaders/${uid}__${host}`);

test('every real payload is accepted, stored, and read back by the app', async () => {
  const all = loadPayloads('heartbeat');
  assert.ok(all.length >= 20, `${all.length} payloads`);
  for (const {name, body} of all) {
    const w = clockWorld();
    const res = await send(w, 'tok-a', body);
    assert.equal(res.status, 204, `${name}: ${JSON.stringify(res.json)}`);
    // The third side (torsion #5115 4): what Settings reads of it.
    const u = toUploader({...stored(w), id: `uidA__${HOST}`});
    assert.equal(u.state, body.state, name);
    assert.equal(u.version, body.version, name);
  }
});

test('every tray version that sends heartbeats has payloads', () => {
  // Versions are only added (contract/README.md: a version's payloads stay
  // while any PC still sends from it).
  const versions = new Set(loadPayloads('heartbeat').map(p => p.body.version));
  for (const v of ['0.1.6', '0.1.7', '0.1.8', '0.1.9', '0.1.10'])
    assert.ok(versions.has(v), `no payload from tray ${v}`);
});

test('the recorder game version: both integers a real LMU reported are accepted, and read as LMU <n>', async () => {
  // Reverting #597 must fail on 0 and 14200 (torsion #5115 8): 0 from the
  // 0.1.9 beat, 14200 from the 1 Oct capture's own meta.
  const [meta] = loadPayloads('capture-meta');
  assert.equal(meta.body.gameVersion, 14200);
  for (const gameVersion of [0, meta.body.gameVersion]) {
    const w = clockWorld();
    const body = mutate(RECORDING, 'recorder.gameVersion', gameVersion);
    assert.equal(
      (await send(w, 'tok-a', body)).status,
      204,
      `gameVersion ${gameVersion}`,
    );
    const u = toUploader({...stored(w), id: `uidA__${HOST}`});
    // 0 is the game reporting none.
    assert.equal(u.recorder.gameVersion, gameVersion ? '14200' : null);
  }
});

test('a PC that cannot read its free space is accepted, and Settings shows it as unknown', async () => {
  const w = clockWorld();
  const body = mutate(RECORDING, 'disk.freeBytes', null);
  assert.equal((await send(w, 'tok-a', body)).status, 204);
  assert.deepEqual(stored(w).disk, {
    captureBytes: RECORDING.disk.captureBytes,
    freeBytes: null,
  });
  const u = toUploader({...stored(w), id: `uidA__${HOST}`});
  assert.equal(u.disk.freeBytes, null);
});

test('a heartbeat is stored under the token owner, stamped by the server', async () => {
  const w = clockWorld();
  let body = mutate(RECORDING, 'sims', {ignored: true});
  body = {...body, ownerId: 'botkin', lastSeenAt: '1999-01-01T00:00:00Z'};
  assert.equal((await send(w, 'tok-a', body)).status, 204);
  const doc = stored(w);
  assert.equal(doc.ownerId, 'uidA');
  assert.equal(doc.hostId, HOST);
  assert.equal(doc.lastSeenAt, '2026-10-13T04:00:00.000Z');
  assert.equal(doc.serverUpdatedAt, '2026-10-13T04:00:00.000Z');
  // Fields the card does not read (sims, lastError) are dropped.
  assert.equal(doc.sims, undefined);
  assert.equal('lastError' in doc, false);
  assert.deepEqual(doc.disk, RECORDING.disk);
  assert.deepEqual(
    [...w.docs.keys()].filter(k => !k.startsWith('users/')),
    [`uploaders/uidA__${HOST}`],
  );
});

test("the legacy owner's heartbeat is stamped botkin, and users cannot touch each other's host", async () => {
  const w = clockWorld();
  await send(w, 'tok-k', RECORDING);
  await send(w, 'tok-a', mutate(RECORDING, 'state', 'idle'));
  await send(w, 'tok-b', mutate(RECORDING, 'state', 'error'));
  assert.equal(stored(w, 'botkin').ownerId, 'botkin');
  // The same hostId for two users is two documents, never one overwritten.
  assert.equal(stored(w, 'uidA').state, 'idle');
  assert.equal(stored(w, 'uidB').state, 'error');
  assert.equal(stored(w, 'uidB').ownerId, 'uidB');
});

test('heartbeats are not counted as documents or bytes, only as heartbeats (marshal #236)', async () => {
  const w = clockWorld();
  await send(w, 'tok-a', RECORDING);
  w.clock.t += 40_000;
  await send(w, 'tok-a', mutate(RECORDING, 'state', 'idle'));
  assert.deepEqual(w.usage.get('uidA'), {
    docs: 0,
    docBytes: 0,
    files: 0,
    fileBytes: 0,
    heartbeats: 2,
  });
});

test('too often is 429 with Retry-After, and the latest state is accepted when allowed', async () => {
  const w = clockWorld();
  const syncing = payload('heartbeat', '0.1.10-syncing-rec-no-game');
  const waiting = payload('heartbeat', '0.1.10-waiting-for-game-rec-no-game');
  assert.equal((await send(w, 'tok-a', syncing)).status, 204);
  // sync started, then finished 5 s later: the second is turned away...
  w.clock.t += 5_000;
  const early = await send(w, 'tok-a', waiting);
  assert.equal(early.status, 429);
  assert.equal(early.headers['Retry-After'], '25');
  assert.equal(stored(w).state, 'syncing');
  assert.equal(w.usage.get('uidA').heartbeats, 1, 'a refused beat is not counted');
  // ...and the tray sends its LATEST state after the wait, which replaces it.
  w.clock.t += 25_000;
  assert.equal((await send(w, 'tok-a', waiting)).status, 204);
  assert.equal(stored(w).state, 'waiting-for-game');
  // Another host of the same user is not held up by this one.
  assert.equal(
    (await send(w, 'tok-a', mutate(waiting, 'hostId', 'other-pc'))).status,
    204,
  );
});

test('a heartbeat needs a token and a safe host id', async () => {
  const w = clockWorld();
  assert.equal((await send(w, null, RECORDING)).status, 401);
  for (const hostId of [
    '',
    '../x',
    'a/b',
    'a\\b',
    '.hidden',
    'x'.repeat(65),
    undefined,
    42,
    null,
  ])
    assert.equal(
      (await send(w, 'tok-a', mutate(RECORDING, 'hostId', hostId))).status,
      400,
      String(hostId),
    );
  assert.equal(w.docs.size, 1, 'only the users/uidK mapping exists');
});

test('a heartbeat is checked field by field', async () => {
  const w = clockWorld();
  const problem = payload('heartbeat', '0.1.6-waiting-for-game-rec-stopped');
  const realProblem = problem.problems[0];
  const bad = [
    ['label', undefined],
    ['label', 'L'.repeat(65)],
    ['version', undefined],
    ['lmuFound', 'yes'],
    ['state', 'on fire'],
    ['state', undefined],
    ['queue', -1],
    ['queue', 1.5e15],
    ['queue', '2'],
    ['sessionsDone', NaN],
    ['progress', 'half'],
    ['lastSessionId', 'x'.repeat(65)],
    ['problems', 'boom'],
    ['problems', Array(11).fill(realProblem)],
    ['disk', 'full'],
    ['disk.freeBytes', -1],
    ['disk.captureBytes', undefined],
    ['recorder.state', 5],
    ['recorder.gameVersion', -1],
    ['recorder.gameVersion', 1.5],
    ['recorder.layoutReason', 'r'.repeat(201)],
  ];
  for (const [path, value] of bad)
    assert.equal(
      (await send(w, 'tok-a', mutate(RECORDING, path, value))).status,
      400,
      `${path} = ${JSON.stringify(value)}`,
    );
  for (const [path, value] of [
    ['problems.0.message', 'm'.repeat(121)],
    ['problems.0.at', {}],
  ])
    assert.equal(
      (await send(w, 'tok-a', mutate(problem, path, value))).status,
      400,
      `${path}`,
    );
  assert.equal(w.usage.get('uidA'), undefined, 'nothing refused was counted');
});

test('problems are rebuilt from their known fields; an unknown kind is dropped, the rest lands', async () => {
  // A newer tray talking to an older server must not lose its heartbeat.
  const w = clockWorld();
  const base = payload('heartbeat', '0.1.6-waiting-for-game-rec-stopped');
  const real = base.problems[0];
  const body = mutate(base, 'problems', [
    {...real, kind: 'on-fire', extra: 'x'},
    {...real, extra: 'dropped'},
  ]);
  assert.equal((await send(w, 'tok-a', body)).status, 204);
  assert.deepEqual(stored(w).problems, [real]);
});

test('a heartbeat problem message stores no token or address', async () => {
  const w = clockWorld();
  const base = payload('heartbeat', '0.1.6-waiting-for-game-rec-stopped');
  const jwt = 'eyJhbGciOi.eyJzdWIiOiIx.sig-nature_1';
  const body = mutate(base, 'problems.0.message', `401 ${jwt} for a@b.example`);
  assert.equal((await send(w, 'tok-a', body)).status, 204);
  assert.equal(stored(w).problems[0].message, '401 <token> for <email>');
});

test("the tray's own report that the uploader stopped is accepted, without lmuFound", async () => {
  // The body itself is the Rust tray's (failure_report.rs report_body); its
  // own test puts that body through contract/check.mjs. Here: the server keeps
  // what it says.
  const w = clockWorld();
  const base = payload('heartbeat', '0.1.6-waiting-for-game-rec-stopped');
  let body = mutate(base, 'lmuFound', undefined);
  body = mutate(body, 'state', 'error');
  body = mutate(body, 'problems.0.kind', 'uploader-stopped');
  assert.equal((await send(w, 'tok-a', body)).status, 204);
  assert.equal(stored(w).problems[0].kind, 'uploader-stopped');
  assert.equal('lmuFound' in stored(w), false, 'not stored when not sent');
});
