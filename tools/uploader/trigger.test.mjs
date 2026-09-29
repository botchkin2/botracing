// Run: node --test tools/uploader/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decide, retryDelayMin} from './trigger.mjs';

const MIN = 60 * 1000;
const base = {
  gameRunning: false,
  wasRunning: false,
  newestMtimeMs: 100 * MIN,
  lastRunAtMs: 50 * MIN,
  nowMs: 101 * MIN,
};

test('runs when the game exits after writing telemetry', () => {
  assert.deepEqual(decide({...base, wasRunning: true}), {
    run: true,
    reason: 'game exited',
  });
});

test('runs on new telemetry with no game, e.g. at logon after a crash', () => {
  assert.equal(decide({...base, lastRunAtMs: null}).run, true);
});

test('does nothing when nothing changed since the last sync', () => {
  assert.equal(decide({...base, lastRunAtMs: 100 * MIN}).run, false);
  assert.equal(decide({...base, newestMtimeMs: null}).run, false);
});

test('never syncs while the game runs, however long it is quiet', () => {
  assert.equal(
    decide({...base, gameRunning: true, wasRunning: true, nowMs: 500 * MIN})
      .run,
    false,
  );
});

test('a failed sync waits for its retry time, then runs again with nothing new', () => {
  const failed = {...base, lastRunAtMs: 200 * MIN, retryAtMs: 230 * MIN};
  assert.equal(decide({...failed, nowMs: 210 * MIN}).run, false);
  assert.deepEqual(decide({...failed, nowMs: 231 * MIN}), {
    run: true,
    reason: 'retry',
  });
});

test('retries back off: 30 min, then doubling, capped at 8 h', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 9].map(retryDelayMin),
    [30, 60, 120, 240, 480, 480, 480],
  );
});

test('a new analysis version resyncs once, never in game', () => {
  const same = {...base, lastRunAtMs: 100 * MIN};
  assert.equal(decide(same).run, false);
  assert.deepEqual(decide({...same, versionChanged: true}), {
    run: true,
    reason: 'new analysis version',
  });
  assert.equal(
    decide({...same, versionChanged: true, gameRunning: true}).run,
    false,
  );
});

test('after a version bump, a failing sync still waits for its retry', () => {
  const failing = {...base, versionChanged: true, retryAtMs: 130 * MIN};
  assert.deepEqual(decide({...failing, nowMs: 101 * MIN}), {
    run: false,
    reason: 'retry later',
  });
  assert.equal(decide({...failing, nowMs: 131 * MIN}).run, true);
});
