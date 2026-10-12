// Run: node --test tools/uploader/driving.test.mjs
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {
  DRIVING_WINDOW_MS,
  inGarage,
  lastState,
  lmuState,
  recentlyWritten,
} from './driving.mjs';
import {decide} from './trigger.mjs';

const now = 1_000_000_000;
const ago = s => now - s * 1000;
const line = (t, a, b) =>
  `  ${t}s game.cpp      555: [State Change] Changing session state from ${a} to ${b}\n`;

test('the last state change in the log is the state', () => {
  const log =
    line(78.4, 'LOADING', 'MONITOR_MENU') +
    line(82.5, 'MONITOR_MENU', 'DRIVING') +
    line(140.1, 'DRIVING', 'MONITOR_MENU');
  assert.equal(lastState(log), 'MONITOR_MENU');
  assert.equal(lastState('no states here'), null);
});

test('in the garage only when the game says so and nothing was written for 60 s', () => {
  const quiet = [{name: 'a.duckdb', mtimeMs: ago(61)}];
  assert.equal(
    inGarage({state: 'MONITOR_MENU', files: quiet, nowMs: now}),
    true,
  );
  assert.equal(inGarage({state: 'DISABLED', files: quiet, nowMs: now}), true);
  // On track, paused on track, the AI driving in the pits, the race's end: a drive.
  for (const state of [
    'DRIVING',
    'PAUSED',
    'PAUSED_AI_IN_PIT',
    'END_OF_RACE_GRACE',
    'LOADING',
  ])
    assert.equal(inGarage({state, files: quiet, nowMs: now}), false, state);
  // No log read: not known, so not the garage.
  assert.equal(inGarage({state: null, files: quiet, nowMs: now}), false);
  // The garage, but a file written 30 s ago: wait.
  const fresh = [{name: 'a.duckdb.wal', mtimeMs: ago(30)}];
  assert.equal(
    inGarage({state: 'MONITOR_MENU', files: fresh, nowMs: now}),
    false,
  );
});

test('a WAL left by a crash months ago is not a write', () => {
  const orphan = {
    name: 'Daytona_P_2026-09-28T00_01_14Z.duckdb.wal',
    mtimeMs: ago(86_400 * 14),
  };
  assert.equal(recentlyWritten([orphan], now), false);
  assert.equal(DRIVING_WINDOW_MS, 60_000);
});

test('the newest trace log is read, from its tail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lmulog-'));
  writeFileSync(
    join(dir, 'trace_2026_10_01_10_00_00-1.txt'),
    line(1, 'DRIVING', 'MONITOR_MENU'),
  );
  writeFileSync(
    join(dir, 'trace.txt'),
    'x'.repeat(300_000) + line(9, 'MONITOR_MENU', 'DRIVING'),
  );
  assert.equal(lmuState(dir), 'DRIVING');
  assert.equal(lmuState(join(dir, 'missing')), null);
});

const base = {
  wasRunning: false,
  newestMtimeMs: ago(120),
  lastRunAtMs: ago(3600),
  nowMs: now,
};

test('in the garage with the game open, a finished drive syncs', () => {
  assert.deepEqual(decide({...base, gameRunning: true, driving: false}), {
    run: true,
    reason: 'drive finished',
  });
});

test('while driving, never', () => {
  assert.deepEqual(decide({...base, gameRunning: true, driving: true}), {
    run: false,
    reason: 'driving',
  });
});

test('game closed: as before', () => {
  assert.deepEqual(decide({...base, gameRunning: false, driving: false}), {
    run: true,
    reason: 'new telemetry',
  });
});
