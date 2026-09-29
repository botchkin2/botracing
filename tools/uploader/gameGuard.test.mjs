// Run: node --test tools/uploader/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {stopWhenGameStarts} from './gameGuard.mjs';

const wait = ms => new Promise(done => setTimeout(done, ms));

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
  await wait(60);
  guard.cancel();
  assert.deepEqual(killed, [4242]);
  assert.equal(guard.stopped(), true);
  assert.equal(checks, 3);
});

test('leaves the sync alone while the game stays closed', async () => {
  const killed = [];
  const guard = stopWhenGameStarts(
    {pid: 1},
    {gameRunning: () => false, kill: pid => killed.push(pid), everyMs: 5},
  );
  await wait(30);
  guard.cancel();
  assert.deepEqual(killed, []);
  assert.equal(guard.stopped(), false);
});
