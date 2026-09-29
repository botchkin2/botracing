// Run: node --test tools/uploader/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decide} from './trigger.mjs';
import {
  newSyncResult,
  progressOf,
  queueCount,
  readSyncLine,
} from './syncOutput.mjs';

const run = lines => lines.reduce(readSyncLine, newSyncResult());

const output = [
  '3 recordings in 2 sessions (C:Telemetry)',
  'aaaaaaaaaaaaaaaa 2026-09-28T20:00 Race       Road Atlanta | 911 | 1 file(s)',
  '  22 laps, 20 comparable, best 80.1',
  'bbbbbbbbbbbbbbbb 2026-09-28T19:00 Practice   Road Atlanta | 911 | 2 file(s)',
  '  failed: Error: upload timed out | at x',
  'done 1, failed 1, unchanged 0',
];

test('reads which session failed, not just how many', () => {
  const r = run(output);
  assert.deepEqual(r.failedIds, ['bbbbbbbbbbbbbbbb']);
  assert.equal(r.done, 1);
  assert.equal(r.failed, 1);
  assert.equal(r.sessions[0], 'aaaaaaaaaaaaaaaa');
});

test('a session that fails once is queued, and retried on the next pass', () => {
  const r = run(output);
  // Its files are already described, so no recording reads as pending.
  assert.equal(queueCount({pendingFiles: 0, failedSessions: r.failedIds}), 1);
  // With nothing new on disk, the retry time alone brings the next sync.
  const MIN = 60 * 1000;
  const next = {
    gameRunning: false,
    wasRunning: false,
    newestMtimeMs: 10 * MIN,
    lastRunAtMs: 5 * MIN,
  };
  assert.equal(
    decide({...next, retryAtMs: 40 * MIN, nowMs: 20 * MIN}).run,
    false,
  );
  assert.equal(
    decide({...next, retryAtMs: 40 * MIN, nowMs: 41 * MIN}).run,
    true,
  );
  // The retry succeeds: nothing failed, nothing queued.
  const again = run([
    'bbbbbbbbbbbbbbbb 2026-09-28T19:00 Practice',
    '  30 laps',
    'done 1, failed 0, unchanged 1',
  ]);
  assert.equal(
    queueCount({pendingFiles: 0, failedSessions: again.failedIds}),
    0,
  );
});

test('progress is done/total once sync.mjs says how many, null before', () => {
  assert.equal(progressOf(newSyncResult()), null);
  const r = newSyncResult();
  readSyncLine(r, '557 recordings in 300 sessions (C:Telemetry)');
  assert.equal(progressOf(r), null);
  readSyncLine(r, 'to do 3');
  assert.deepEqual(progressOf(r), {done: 0, total: 3});
  readSyncLine(r, 'aaaaaaaaaaaaaaaa 2026-09-28T20:00 Race       Road Atlanta | 911 | 1 file(s)');
  readSyncLine(r, '  22 laps, 20 comparable, best 80.1');
  assert.deepEqual(progressOf(r), {done: 1, total: 3});
  readSyncLine(r, 'bbbbbbbbbbbbbbbb 2026-09-28T19:00 Practice   Road Atlanta | 911 | 2 file(s)');
  readSyncLine(r, '  failed: Error: upload timed out');
  assert.deepEqual(progressOf(r), {done: 2, total: 3});
});
