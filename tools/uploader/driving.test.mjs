// Run: node --test tools/uploader/driving.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DRIVING_WINDOW_MS, drivingNow} from './driving.mjs';
import {decide} from './trigger.mjs';

const now = 1_000_000_000;
const ago = s => now - s * 1000;

test('a recording or WAL written in the last 20 s is a drive in progress', () => {
  assert.equal(
    drivingNow([{name: 'a.duckdb.wal', mtimeMs: ago(3)}], now),
    true,
  );
  assert.equal(drivingNow([{name: 'b.ibt', mtimeMs: ago(19)}], now), true);
});

test('back in the garage: the drive file stops changing and nothing counts', () => {
  assert.equal(drivingNow([{name: 'a.duckdb', mtimeMs: ago(25)}], now), false);
});

test('a WAL left by a crash months ago is not a drive', () => {
  const orphan = {
    name: 'Daytona_P_2026-09-28T00_01_14Z.duckdb.wal',
    mtimeMs: ago(86_400 * 14),
  };
  assert.equal(drivingNow([orphan], now), false);
});

test('the window is 20 s', () => {
  assert.equal(DRIVING_WINDOW_MS, 20_000);
  assert.equal(drivingNow([{name: 'x', mtimeMs: ago(20)}], now), false);
});

const base = {
  wasRunning: false,
  newestMtimeMs: ago(60),
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
