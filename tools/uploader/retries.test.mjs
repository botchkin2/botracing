// Run: node --test tools/uploader/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {earliestRetryMs, nextRetries, waitingIds} from './retries.mjs';
import {decide} from './trigger.mjs';

const MIN = 60 * 1000;

test('a failing session backs off 30 min, then 60, and drops out on success', () => {
  const first = nextRetries({
    retries: {},
    failedIds: ['a'],
    skippedIds: [],
    nowMs: 0,
  });
  assert.deepEqual(first, {
    a: {failures: 1, atMs: 30 * MIN, lastAtMs: 0, message: null},
  });
  const second = nextRetries({
    retries: first,
    failedIds: ['a'],
    skippedIds: [],
    messages: {a: 'HTTP 413 doc too large'},
    nowMs: 31 * MIN,
  });
  assert.deepEqual(second, {
    a: {
      failures: 2,
      atMs: 91 * MIN,
      lastAtMs: 31 * MIN,
      message: 'HTTP 413 doc too large',
    },
  });
  const fixed = nextRetries({
    retries: second,
    failedIds: [],
    skippedIds: [],
    nowMs: 92 * MIN,
  });
  assert.deepEqual(fixed, {});
});

test('a skipped session keeps its wait; a new failure starts its own', () => {
  const retries = {a: {failures: 3, atMs: 200 * MIN}};
  const next = nextRetries({
    retries,
    failedIds: ['b'],
    skippedIds: ['a'],
    nowMs: 50 * MIN,
  });
  assert.deepEqual(next, {
    a: {failures: 3, atMs: 200 * MIN},
    b: {failures: 1, atMs: 80 * MIN, lastAtMs: 50 * MIN, message: null},
  });
});

test('only sessions still inside their wait are skipped', () => {
  const retries = {
    a: {failures: 1, atMs: 30 * MIN},
    b: {failures: 1, atMs: 90 * MIN},
  };
  assert.deepEqual(waitingIds(retries, 60 * MIN), ['b']);
  assert.deepEqual(waitingIds({}, 60 * MIN), []);
  assert.equal(earliestRetryMs(retries), 30 * MIN);
  assert.equal(earliestRetryMs({}), null);
});

// scrutineer #742: a version bump with one always-failing session is one
// pass; then that session waits on its backoff and nothing reruns.
test('version bump plus one failing session: one pass, then only its retry', () => {
  const base = {
    gameRunning: false,
    wasRunning: false,
    newestMtimeMs: 10 * MIN,
    lastRunAtMs: 20 * MIN,
  };
  const bumped = decide({...base, versionChanged: true, nowMs: 100 * MIN});
  assert.deepEqual(bumped, {run: true, reason: 'new analysis version'});
  // The pass ends with session "bad" failed; the version is recorded.
  const retries = nextRetries({
    retries: {},
    failedIds: ['bad'],
    skippedIds: [],
    nowMs: 100 * MIN,
  });
  const after = {
    ...base,
    lastRunAtMs: 100 * MIN,
    versionChanged: false,
    sessionRetryAtMs: earliestRetryMs(retries),
  };
  assert.deepEqual(waitingIds(retries, 101 * MIN), ['bad']);
  assert.equal(decide({...after, nowMs: 101 * MIN}).run, false);
  assert.deepEqual(decide({...after, nowMs: 131 * MIN}), {
    run: true,
    reason: 'retry',
  });
});
