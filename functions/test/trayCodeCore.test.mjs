import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {test} from 'node:test';
import {
  CODES_PER_HOUR,
  CODE_TTL_MS,
  HOUR_MS,
  challengeOf,
  handleTray,
  sha256Hex,
} from '../src/trayCodeCore.ts';

// In-memory stand-ins for the Firestore and Admin Auth bindings in trayApi.ts.
function world({tokens = {'id-a': 'uidA', 'id-b': 'uidB'}} = {}) {
  const records = new Map();
  const asks = new Map();
  const state = {nowMs: 1_000_000, nextCode: null, minted: []};
  const deps = {
    verifyToken: async t => {
      if (!tokens[t]) throw new Error('bad token');
      return {uid: tokens[t]};
    },
    put: async (hash, record) => {
      records.set(hash, record);
    },
    take: async hash => {
      const record = records.get(hash) ?? null;
      records.delete(hash);
      return record;
    },
    allow: async (uid, now) => {
      const w = asks.get(uid);
      const fresh = !w || now - w.startMs >= HOUR_MS;
      const count = fresh ? 0 : w.count;
      if (count >= CODES_PER_HOUR) return false;
      asks.set(uid, {startMs: fresh ? now : w.startMs, count: count + 1});
      return true;
    },
    mint: async uid => {
      state.minted.push(uid);
      return {customToken: `custom-for-${uid}`, email: `${uid}@example.com`};
    },
    now: () => state.nowMs,
    newCode: () => state.nextCode ?? randomBytes(32).toString('base64url'),
  };
  return {deps, records, state};
}

const verifier = () => randomBytes(32).toString('base64url');
const call = (deps, path, json, authorization, method = 'POST') =>
  handleTray(deps, {method, path, json, authorization});

async function askForCode(deps, challenge, token = 'id-a') {
  return call(deps, '/code', {challenge}, `Bearer ${token}`);
}

test('a signed-in user gets a code for a challenge, and the tray trades it for a custom token', async () => {
  const {deps, state} = world();
  const v = verifier();
  const code = await askForCode(deps, challengeOf(v));
  assert.equal(code.status, 200);
  assert.equal(code.json.expiresInS, CODE_TTL_MS / 1000);
  const token = await call(deps, '/token', {code: code.json.code, verifier: v});
  assert.equal(token.status, 200);
  assert.deepEqual(token.json, {
    customToken: 'custom-for-uidA',
    uid: 'uidA',
    email: 'uidA@example.com',
  });
  assert.deepEqual(state.minted, ['uidA']);
});

test('only the hash of the code is stored, and the challenge it is bound to', async () => {
  const {deps, records} = world();
  const v = verifier();
  const code = (await askForCode(deps, challengeOf(v))).json.code;
  assert.deepEqual([...records.keys()], [sha256Hex(code)]);
  assert.ok(![...records.keys()].includes(code));
  assert.equal([...records.values()][0].challenge, challengeOf(v));
});

test('a code without its verifier is refused, and a wrong verifier burns the code', async () => {
  const {deps, state} = world();
  const v = verifier();
  const code = (await askForCode(deps, challengeOf(v))).json.code;
  const wrong = await call(deps, '/token', {code, verifier: verifier()});
  assert.equal(wrong.status, 400);
  // The right verifier is too late: the guess consumed the code.
  const right = await call(deps, '/token', {code, verifier: v});
  assert.equal(right.status, 400);
  assert.deepEqual(state.minted, []);
});

test('a code can be used once', async () => {
  const {deps, state} = world();
  const v = verifier();
  const code = (await askForCode(deps, challengeOf(v))).json.code;
  assert.equal((await call(deps, '/token', {code, verifier: v})).status, 200);
  assert.equal((await call(deps, '/token', {code, verifier: v})).status, 400);
  assert.deepEqual(state.minted, ['uidA']);
});

test('an expired code is refused', async () => {
  const {deps, state} = world();
  const v = verifier();
  const code = (await askForCode(deps, challengeOf(v))).json.code;
  state.nowMs += CODE_TTL_MS + 1;
  assert.equal((await call(deps, '/token', {code, verifier: v})).status, 400);
  assert.deepEqual(state.minted, []);
});

test('every reason a code fails gets the same answer', async () => {
  const {deps, state} = world();
  const v = verifier();
  const live = (await askForCode(deps, challengeOf(v))).json.code;
  const unknown = await call(deps, '/token', {code: verifier(), verifier: v});
  const wrongVerifier = await call(deps, '/token', {
    code: live,
    verifier: verifier(),
  });
  const code2 = (await askForCode(deps, challengeOf(v))).json.code;
  state.nowMs += CODE_TTL_MS + 1;
  const expired = await call(deps, '/token', {code: code2, verifier: v});
  assert.deepEqual(unknown, wrongVerifier);
  assert.deepEqual(unknown, expired);
});

test('/code needs a signed-in user', async () => {
  const {deps} = world();
  const challenge = challengeOf(verifier());
  assert.equal((await call(deps, '/code', {challenge}, undefined)).status, 401);
  assert.equal(
    (await call(deps, '/code', {challenge}, 'Bearer nope')).status,
    401,
  );
  assert.equal((await call(deps, '/code', {challenge}, 'id-a')).status, 401);
});

test('/code refuses a challenge that is not the hash of 32 bytes', async () => {
  const {deps, records} = world();
  for (const challenge of [
    '',
    'short',
    'x'.repeat(44),
    `${'a'.repeat(42)}!`,
    7,
    null,
  ]) {
    const out = await askForCode(deps, challenge);
    assert.equal(out.status, 400, String(challenge));
  }
  assert.equal(records.size, 0);
});

test('/token refuses codes and verifiers of the wrong shape without touching the store', async () => {
  const {deps} = world();
  let touched = false;
  deps.take = async () => {
    touched = true;
    return null;
  };
  for (const body of [
    {},
    {code: 'short', verifier: verifier()},
    {code: verifier(), verifier: 'short'},
    {code: `${'a'.repeat(42)}!`, verifier: verifier()},
    {code: verifier(), verifier: 'v'.repeat(129)},
    {code: 5, verifier: 5},
  ])
    assert.equal((await call(deps, '/token', body)).status, 400);
  assert.equal(touched, false);
});

test('a user may ask for ten codes an hour, then waits', async () => {
  const {deps, state} = world();
  const challenge = challengeOf(verifier());
  for (let i = 0; i < CODES_PER_HOUR; i++)
    assert.equal((await askForCode(deps, challenge)).status, 200);
  assert.equal((await askForCode(deps, challenge)).status, 429);
  // Another user is not held up by it.
  assert.equal((await askForCode(deps, challenge, 'id-b')).status, 200);
  state.nowMs += HOUR_MS;
  assert.equal((await askForCode(deps, challenge)).status, 200);
});

test('the custom token is only ever in a response body, never a URL', async () => {
  const {deps} = world();
  const v = verifier();
  const code = await askForCode(deps, challengeOf(v));
  const token = await call(deps, '/token', {code: code.json.code, verifier: v});
  assert.ok(!JSON.stringify(code.json).includes('custom-for'));
  assert.ok(!JSON.stringify(code.json).includes('http'));
  assert.ok(!Object.values(token.json).some(x => String(x).includes('http')));
});

test('other methods and paths are refused', async () => {
  const {deps} = world();
  assert.equal(
    (await call(deps, '/code', {}, 'Bearer id-a', 'GET')).status,
    405,
  );
  assert.equal((await call(deps, '/nothing', {})).status, 404);
});
