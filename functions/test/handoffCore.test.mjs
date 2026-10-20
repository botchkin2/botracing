import assert from 'node:assert/strict';
import {test} from 'node:test';

import {HANDOFFS_PER_MINUTE, handleHandoff} from '../src/handoffCore.ts';

function deps({verify = async () => ({uid: 'u1'}), allowed = true} = {}) {
  const calls = {verify: [], allow: [], mint: []};
  return {
    calls,
    deps: {
      verifyToken: async t => {
        calls.verify.push(t);
        return verify(t);
      },
      allow: async (uid, now) => {
        calls.allow.push([uid, now]);
        return allowed;
      },
      mint: async uid => {
        calls.mint.push(uid);
        return `custom-for-${uid}`;
      },
      now: () => 1000,
    },
  };
}

test('a good ID token gets a custom token for the same user, and nothing else', async () => {
  const {deps: d, calls} = deps();
  const out = await handleHandoff(d, {method: 'POST', authorization: 'Bearer id-token'});
  assert.equal(out.status, 200);
  assert.deepEqual(out.json, {token: 'custom-for-u1'});
  assert.deepEqual(calls.verify, ['id-token']);
  assert.deepEqual(calls.mint, ['u1']);
  assert.deepEqual(calls.allow, [['u1', 1000]]);
});

test('no token, a bad one or a revoked one is a 401 and mints nothing', async () => {
  for (const authorization of [undefined, '', 'Bearer ', 'Basic abc', 'Bearer bad']) {
    const {deps: d, calls} = deps({
      verify: async () => {
        throw new Error('auth/id-token-revoked');
      },
    });
    const out = await handleHandoff(d, {method: 'POST', authorization});
    assert.equal(out.status, 401);
    assert.deepEqual(out.json, {error: 'sign in'});
    assert.deepEqual(calls.mint, []);
  }
});

test('only POST', async () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const {deps: d, calls} = deps();
    const out = await handleHandoff(d, {method, authorization: 'Bearer id-token'});
    assert.equal(out.status, 405);
    assert.deepEqual(calls.verify, []);
  }
});

test('the user is the verified token\'s: a request cannot name one', async () => {
  const {deps: d, calls} = deps({verify: async () => ({uid: 'real'})});
  // the request type has no body or query: anything extra on the object is not read
  const out = await handleHandoff(d, {method: 'POST', authorization: 'Bearer t', body: {uid: 'victim'}, query: {uid: 'victim'}});
  assert.equal(out.status, 200);
  assert.deepEqual(calls.mint, ['real']);
});

test('past the per-minute limit is a 429 and mints nothing', async () => {
  assert.equal(HANDOFFS_PER_MINUTE, 10);
  const {deps: d, calls} = deps({allowed: false});
  const out = await handleHandoff(d, {method: 'POST', authorization: 'Bearer t'});
  assert.equal(out.status, 429);
  assert.deepEqual(calls.mint, []);
});
