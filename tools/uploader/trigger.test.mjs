// Run: node --test tools/uploader/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {IN_GAME_JOBS, decide} from './trigger.mjs';

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

test('in game, waits for 10 quiet minutes, then syncs with few workers', () => {
  assert.equal(
    decide({...base, gameRunning: true, wasRunning: true}).run,
    false,
  );
  assert.deepEqual(
    decide({...base, gameRunning: true, wasRunning: true, nowMs: 110 * MIN}),
    {
      run: true,
      jobs: IN_GAME_JOBS,
      reason: 'quiet in game',
    },
  );
});
