// Run: node --test tools/uploader/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {stopWhenGameStarts} from './gameGuard.mjs';

// Under a full `npm run check` the timers starve, so a fixed sleep for a 5 ms
// tick is a race (it failed three seats' checks). Every test waits for the
// condition it asserts on instead, and the deadline only bounds a real hang.
const DEADLINE_MS = 2000;

async function until(condition) {
  const start = Date.now();
  while (!condition()) {
    assert.ok(Date.now() - start < DEADLINE_MS, 'condition not met in 2 s');
    await new Promise(done => setTimeout(done, 1));
  }
}

test('stops the sync once, when the game starts mid-sync', async () => {
  let checks = 0;
  const killed = [];
  const guard = stopWhenGameStarts(
    {pid: 4242},
    {
      gameRunning: () => ++checks >= 3,
      kill: pid => killed.push(pid),
      everyMs: 5,
    },
  );
  await until(() => guard.stopped());
  guard.cancel();
  assert.deepEqual(killed, [4242]);
  assert.equal(checks, 3);
});

test('leaves the sync alone while the game stays closed', async () => {
  let checks = 0;
  const killed = [];
  const guard = stopWhenGameStarts(
    {pid: 1},
    {
      gameRunning: () => {
        checks++;
        return false;
      },
      kill: pid => killed.push(pid),
      everyMs: 5,
    },
  );
  await until(() => checks >= 5);
  guard.cancel();
  assert.deepEqual(killed, []);
  assert.equal(guard.stopped(), false);
});

test('a kill that fails because the sync just exited does not throw', async () => {
  let kills = 0;
  const guard = stopWhenGameStarts(
    {pid: 7},
    {
      gameRunning: () => true,
      kill: () => {
        kills++;
        throw new Error('taskkill: process 7 not found (exit 128)');
      },
      everyMs: 5,
    },
  );
  await until(() => kills > 0);
  guard.cancel();
  assert.equal(guard.stopped(), true);
});

test('a game check that throws is retried, not fatal', async () => {
  let calls = 0;
  const killed = [];
  const guard = stopWhenGameStarts(
    {pid: 9},
    {
      gameRunning: () => {
        if (++calls === 1) throw new Error('tasklist failed');
        return true;
      },
      kill: pid => killed.push(pid),
      everyMs: 5,
    },
  );
  await until(() => killed.length > 0);
  guard.cancel();
  assert.deepEqual(killed, [9]);
  assert.equal(calls, 2);
});
