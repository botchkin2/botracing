// Run: node --test tools/sessions/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isTransient, withNetRetry} from './netRetry.mjs';

const reset = () =>
  Object.assign(new Error('read ECONNRESET'), {code: 'ECONNRESET'});
const noWait = {waitMs: async () => {}};

test('a reset is retried and the call then succeeds', async () => {
  let calls = 0;
  const value = await withNetRetry(async () => {
    if (++calls < 3) throw reset();
    return 'ok';
  }, noWait);
  assert.equal(value, 'ok');
  assert.equal(calls, 3);
});

test('gives up after the last try and throws the network error', async () => {
  let calls = 0;
  await assert.rejects(
    withNetRetry(async () => {
      calls++;
      throw reset();
    }, noWait),
    /ECONNRESET/,
  );
  assert.equal(calls, 4);
});

test('waits 1 s, 2 s, 4 s between tries', async () => {
  const waits = [];
  await assert.rejects(
    withNetRetry(
      async () => {
        throw reset();
      },
      {waitMs: async ms => waits.push(ms)},
    ),
  );
  assert.deepEqual(waits, [1000, 2000, 4000]);
});

test('anything else fails at once, with no retry', async () => {
  let calls = 0;
  await assert.rejects(
    withNetRetry(async () => {
      calls++;
      throw Object.assign(new Error('forbidden'), {code: 403});
    }, noWait),
    /forbidden/,
  );
  assert.equal(calls, 1);
});

test('finds the reset inside a wrapped FetchError', () => {
  const inner = Object.assign(new Error('boom'), {code: 'ECONNRESET'});
  assert.equal(
    isTransient(Object.assign(new Error('wrapped'), {cause: inner})),
    true,
  );
  assert.equal(
    isTransient(
      new Error(
        'request to storage.googleapis.com failed, reason: read ECONNRESET',
      ),
    ),
    true,
  );
  assert.equal(isTransient(new Error('nope')), false);
});
