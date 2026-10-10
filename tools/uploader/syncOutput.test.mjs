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
  assert.deepEqual(r.failureOf, {
    bbbbbbbbbbbbbbbb: 'Error: upload timed out | at x',
  });
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
  readSyncLine(
    r,
    'aaaaaaaaaaaaaaaa 2026-09-28T20:00 Race       Road Atlanta | 911 | 1 file(s)',
  );
  readSyncLine(r, '  22 laps, 20 comparable, best 80.1');
  assert.deepEqual(progressOf(r), {done: 1, total: 3});
  readSyncLine(
    r,
    'bbbbbbbbbbbbbbbb 2026-09-28T19:00 Practice   Road Atlanta | 911 | 2 file(s)',
  );
  readSyncLine(r, '  failed: Error: upload timed out');
  assert.deepEqual(progressOf(r), {done: 2, total: 3});
});

test('a sync is finished only once its closing line is read', () => {
  assert.equal(run(output).finished, true);
  // Died after a failed block, before the closing line: a crash, not a pass
  // with one failure (camber #780). Exit code 1 alone cannot tell them apart.
  const died = run(output.slice(0, -1));
  assert.deepEqual(died.failedIds, ['bbbbbbbbbbbbbbbb']);
  assert.equal(died.finished, false);
  assert.equal(newSyncResult().finished, false);
});

test('the surface fold takes over the progress once the sessions are done', () => {
  const r = newSyncResult();
  readSyncLine(r, 'to do 2');
  readSyncLine(
    r,
    'aaaaaaaaaaaaaaaa 2026-09-28T20:00 Race       Road Atlanta | 911 | 1 file(s)',
  );
  readSyncLine(
    r,
    'bbbbbbbbbbbbbbbb 2026-09-28T19:00 Race       Road Atlanta | 911 | 1 file(s)',
  );
  readSyncLine(r, 'done 2, failed 0, unchanged 0');
  // The sessions sit at 2/2 through the fold: that is what read as stuck.
  assert.deepEqual(progressOf(r), {done: 2, total: 2});
  readSyncLine(r, 'surface 0/13 tracks');
  assert.deepEqual(progressOf(r), {done: 0, total: 13, phase: 'surface'});
  readSyncLine(r, 'lmu-sebring: +51 sessions, +226 laps, 51 sessions in all');
  readSyncLine(r, 'surface 7/13 tracks');
  assert.deepEqual(progressOf(r), {done: 7, total: 13, phase: 'surface'});
  readSyncLine(r, 'surface 13/13 tracks');
  assert.deepEqual(progressOf(r), {done: 13, total: 13, phase: 'surface'});
  // The fold lines are not sessions, failures or the closing line.
  assert.equal(r.sessions.length, 2);
  assert.equal(r.failed, 0);
});

test('a fold block stores nothing: it is progress, not an upload, and a failed one is not a failed session', () => {
  const r = newSyncResult();
  readSyncLine(r, 'to do 4');
  // The fold pass before the sessions, then the sessions themselves.
  readSyncLine(
    r,
    'aaaaaaaaaaaaaaaa fold: 2026-09-28T20:00 Race   Road Atlanta | 911 | 1 file(s)',
  );
  readSyncLine(
    r,
    'bbbbbbbbbbbbbbbb fold: 2026-09-28T19:00 Race   Road Atlanta | 911 | 1 file(s)',
  );
  readSyncLine(r, '  failed: Error: could not read the recording');
  assert.deepEqual(progressOf(r), {done: 2, total: 4});
  readSyncLine(
    r,
    'aaaaaaaaaaaaaaaa 2026-09-28T20:00 Race   Road Atlanta | 911 | 1 file(s)',
  );
  assert.equal(r.sessions.length, 3);
  assert.equal(r.folded, 2);
  // Only the session block is an upload; the failed fold is no failed session.
  assert.deepEqual(r.stored, ['aaaaaaaaaaaaaaaa']);
  assert.deepEqual(r.failedIds, []);
  assert.equal(r.errors.length, 1);
  // A stop here (the game started) has uploaded one session, not three.
  assert.equal(r.stored.length - r.failedIds.length, 1);
});

test('a sync that dies before its closing line reports the error line', () => {
  const r = run([
    'to do 3',
    'file:///x/sync.mjs:120',
    '      return staleRev(a);',
    '',
    'RangeError: Maximum call stack size exceeded',
    '    at staleRev (file:///x/sync.mjs:120:7)',
  ]);
  assert.equal(r.finished, false);
  assert.equal(r.crash, 'RangeError: Maximum call stack size exceeded');
});

test('a finished sync with a failed session is not a crash', () => {
  assert.equal(run(output).crash, null);
});

test('a sync that left fresh files alone says how many', () => {
  const r = newSyncResult();
  assert.equal(r.waiting, 0);
  readSyncLine(r, '1 file(s) still being written, skipped for now');
  assert.equal(r.waiting, 1);
  readSyncLine(r, 'done 0, failed 0, unchanged 0');
  assert.equal(r.finished, true);
});

test('a recording the sync could not read is named once, with the reason', () => {
  const r = newSyncResult();
  readSyncLine(
    r,
    'skip fordmustanggt3_fuji gp 2026-10-04 10-52-05.ibt: fordmustanggt3_fuji gp 2026-10-04 10-52-05.ibt has no samples',
  );
  readSyncLine(r, 'skip b.ibt: could not open the file');
  assert.deepEqual(r.unreadable, [
    {
      name: 'fordmustanggt3_fuji gp 2026-10-04 10-52-05.ibt',
      why: 'has no samples',
    },
    {name: 'b.ibt', why: 'could not open the file'},
  ]);
});
