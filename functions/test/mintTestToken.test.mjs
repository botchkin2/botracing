import assert from 'node:assert/strict';
import {test} from 'node:test';
import {exchangeForIdToken, mintTestLinks} from '../scripts/mintTestToken.mjs';

function fakeAuth({exists = true} = {}) {
  const created = [];
  return {
    created,
    getUser: async uid => {
      if (!exists)
        throw Object.assign(new Error('nope'), {code: 'auth/user-not-found'});
      return {uid};
    },
    createUser: async ({uid}) => created.push(uid),
    createCustomToken: async uid => `custom-${uid}`,
  };
}

test('prints one link per origin with the token in the fragment', async () => {
  const {links} = await mintTestLinks({
    auth: fakeAuth(),
    origins: ['http://localhost:19101/', 'https://p--pr1.web.app'],
  });
  assert.deepEqual(links, [
    'http://localhost:19101/#ct=custom-seat-test',
    'https://p--pr1.web.app/#ct=custom-seat-test',
  ]);
});

test('refuses any uid that is not a seat-test user', async () => {
  await assert.rejects(
    mintTestLinks({
      auth: fakeAuth(),
      origins: ['http://x'],
      uid: 'real-user-uid',
    }),
    /only seat-test users/,
  );
});

test('does not create the user unless asked', async () => {
  const auth = fakeAuth({exists: false});
  await assert.rejects(
    mintTestLinks({auth, origins: ['http://x']}),
    /does not exist yet/,
  );
  assert.deepEqual(auth.created, []);
  await mintTestLinks({auth, origins: ['http://x'], create: true});
  assert.deepEqual(auth.created, ['seat-test']);
});

test('exchanges the custom token for an ID token, and says why when it cannot', async () => {
  let sent;
  const ok = async (url, init) => {
    sent = {url: String(url), body: JSON.parse(init.body)};
    return Response.json({idToken: 'id-1'});
  };
  assert.equal(
    await exchangeForIdToken({customToken: 'ct', fetch: ok, apiKey: 'K'}),
    'id-1',
  );
  assert.match(sent.url, /key=K$/);
  assert.equal(sent.body.token, 'ct');
  await assert.rejects(
    exchangeForIdToken({
      customToken: 'ct',
      fetch: async () => new Response('bad', {status: 400}),
    }),
    /400 bad/,
  );
});
