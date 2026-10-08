import assert from 'node:assert/strict';
import {test} from 'node:test';
import {smokeWithTemporaryUsers} from '../scripts/smokeTokens.mjs';

function fakes({failExchange = false, failCreateSecond = false} = {}) {
  const users = new Set();
  const usageDeleted = [];
  const exchanged = [];
  const auth = {
    createUser: async ({uid}) => {
      if (failCreateSecond && users.size === 1) throw new Error('quota');
      users.add(uid);
    },
    createCustomToken: async uid => `custom-${uid}`,
    deleteUser: async uid => {
      assert.ok(
        users.delete(uid),
        `deleted a user that was not created: ${uid}`,
      );
    },
  };
  const firestore = {
    doc: path => ({delete: async () => usageDeleted.push(path)}),
  };
  const fetch = async (url, init) => {
    const {token} = JSON.parse(init.body);
    exchanged.push({url: String(url), token});
    if (failExchange) return new Response('nope', {status: 400});
    return Response.json({idToken: `id-${token}`});
  };
  return {auth, firestore, fetch, users, usageDeleted, exchanged};
}

test('creates two users, hands their ID tokens to the smoke, then deletes both', async () => {
  const f = fakes();
  let env;
  const code = await smokeWithTemporaryUsers({
    ...f,
    apiKey: 'KEY',
    log: () => {},
    runSmoke: async e => {
      env = e;
      assert.equal(f.users.size, 2, 'both users exist while the smoke runs');
      return 0;
    },
  });
  assert.equal(code, 0);
  assert.match(env.SMOKE_TOKEN_A, /^id-custom-smoke-a-/);
  assert.match(env.SMOKE_TOKEN_B, /^id-custom-smoke-b-/);
  assert.ok(f.exchanged.every(x => x.url.includes('key=KEY')));
  assert.equal(f.users.size, 0);
  assert.equal(f.usageDeleted.length, 2);
});

test('a failing smoke still deletes the users and returns its exit code', async () => {
  const f = fakes();
  const code = await smokeWithTemporaryUsers({
    ...f,
    apiKey: 'KEY',
    log: () => {},
    runSmoke: async () => 1,
  });
  assert.equal(code, 1);
  assert.equal(f.users.size, 0);
});

test('a failed token exchange never runs the smoke and still cleans up', async () => {
  const f = fakes({failExchange: true});
  let ran = false;
  const code = await smokeWithTemporaryUsers({
    ...f,
    apiKey: 'KEY',
    log: () => {},
    runSmoke: async () => {
      ran = true;
      return 0;
    },
  });
  assert.notEqual(code, 0);
  assert.equal(ran, false);
  assert.equal(f.users.size, 0);
});

test('if the second user cannot be created, the first is deleted', async () => {
  const f = fakes({failCreateSecond: true});
  const code = await smokeWithTemporaryUsers({
    ...f,
    apiKey: 'KEY',
    log: () => {},
    runSmoke: async () => 0,
  });
  assert.notEqual(code, 0);
  assert.equal(f.users.size, 0);
  assert.equal(f.usageDeleted.length, 1);
});

test('Ctrl+C while the smoke runs: the run stops and both users are still deleted', async () => {
  const f = fakes();
  const abort = new AbortController();
  const code = await smokeWithTemporaryUsers({
    ...f,
    apiKey: 'KEY',
    log: () => {},
    signal: abort.signal,
    runSmoke: (_env, signal) =>
      new Promise((_done, fail) => {
        signal.addEventListener('abort', () => fail(signal.reason));
        abort.abort(); // the user presses Ctrl+C
      }),
  });
  assert.notEqual(code, 0);
  assert.equal(f.users.size, 0);
  assert.equal(f.usageDeleted.length, 2);
});

test('Ctrl+C before the first user is created creates nothing', async () => {
  const f = fakes();
  const abort = new AbortController();
  abort.abort();
  let ran = false;
  const code = await smokeWithTemporaryUsers({
    ...f,
    apiKey: 'KEY',
    log: () => {},
    signal: abort.signal,
    runSmoke: async () => {
      ran = true;
      return 0;
    },
  });
  assert.notEqual(code, 0);
  assert.equal(ran, false);
  assert.equal(f.users.size, 0);
  assert.equal(f.usageDeleted.length, 0);
});

test('whatever the smoke left under each user is swept before the user is deleted', async () => {
  const f = fakes();
  const swept = [];
  await smokeWithTemporaryUsers({
    ...f,
    apiKey: 'KEY',
    log: () => {},
    runSmoke: async () => 1,
    sweep: async uid => {
      assert.ok(f.users.has(uid), 'swept while the user still exists');
      swept.push(uid);
    },
  });
  assert.equal(swept.length, 2);
  // A failing sweep must not stop the users being deleted.
  const g = fakes();
  await smokeWithTemporaryUsers({
    ...g,
    apiKey: 'KEY',
    log: () => {},
    runSmoke: async () => 0,
    sweep: async () => {
      throw new Error('bucket down');
    },
  });
  assert.equal(g.users.size, 0);
});
