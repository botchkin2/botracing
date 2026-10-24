import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, mkdirSync, readFileSync, statSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  chooseReplay,
  COPY_FAIL_MESSAGE,
  COPY_TRIES,
  fileSettled,
  linkKind,
  logStoppedInWindow,
  maintainReplayCopies,
  planCopies,
  recorderLoggedProblem,
  REPLAY_KEEP_MS,
} from './replaySafety.mjs';

const now = Date.parse('2026-10-24T03:00:00Z');
const minute = 60 * 1000;

test('a loss in the capture meta is a recorder problem; a quiet capture is not', () => {
  assert.equal(recorderLoggedProblem({meta: {}}), false);
  assert.equal(recorderLoggedProblem({meta: {writeFailures: 1}}), true);
  assert.equal(recorderLoggedProblem({meta: {gaps: 2}}), true);
  assert.equal(recorderLoggedProblem({meta: {lostChunks: 1}}), true);
  assert.equal(recorderLoggedProblem({meta: {lastWriteError: 'disk full'}}), true);
  assert.equal(recorderLoggedProblem({meta: {layoutDoubtful: 9}}), false);
});

test('a recorder-stopped line counts only inside the capture window, and not an iRacing line', () => {
  const log = [
    '2026-10-24T01:00:00Z recorder recorder stopped (panic); starting again in 5 s',
    '2026-10-24T02:10:00Z recorder iracing: recorder stopped (panic); starting again in 5 s',
    '2026-10-24T02:30:00Z recorder recorder stopped (header); starting again in 5 s',
  ].join('\n');
  const since = Date.parse('2026-10-24T02:00:00Z');
  assert.equal(logStoppedInWindow(log, since, now), true);
  assert.equal(
    logStoppedInWindow(
      '2026-10-24T02:10:00Z recorder iracing: recorder stopped (panic); starting again in 5 s',
      since,
      now,
    ),
    false,
  );
  assert.equal(
    recorderLoggedProblem({
      meta: {},
      logText: log,
      sinceMs: since,
      untilMs: Date.parse('2026-10-24T02:20:00Z'),
    }),
    false,
  );
});

test('the replay is the newest finished file written during the capture', () => {
  const from = now - 20 * minute;
  const files = [
    {name: 'old.Vcr', mtimeMs: from - minute, temp: false},
    {name: 'mid.Vcr', mtimeMs: from + 5 * minute, temp: false},
    {name: 'late.Vcr', mtimeMs: from + 10 * minute, temp: false},
    {name: 'writing.tmp', mtimeMs: from + 12 * minute, temp: true},
    {name: '_tmp123', mtimeMs: from + 13 * minute, temp: false},
  ];
  assert.equal(chooseReplay(files, {fromMs: from, toMs: now}).name, 'late.Vcr');
  assert.equal(chooseReplay(files, {fromMs: now + minute, toMs: now + minute}), null);
});

test('a settled file is always a copy, never a link', () => {
  assert.equal(linkKind({tempFile: false, settled: true}), 'copy');
  assert.equal(linkKind({tempFile: false, settled: false}), 'wait');
  assert.equal(linkKind({tempFile: true, settled: true}), 'skip');
  assert.equal(fileSettled({size: 10, mtimeMs: 1}, {size: 10, mtimeMs: 1}), true);
  assert.equal(fileSettled({size: 10, mtimeMs: 1}, {size: 11, mtimeMs: 2}), false);
});

test('verified copies go, old unverified copies go, and the cap never drops an unverified one', () => {
  const young = now - 1000;
  const old = now - REPLAY_KEEP_MS - 1;
  const plan = planCopies(
    [
      {id: 'verified', bytes: 500, takenMs: young, verified: true},
      {id: 'old', bytes: 500, takenMs: old, verified: false},
      {id: 'keep', bytes: 1500, takenMs: young, verified: false},
    ],
    now,
    {capBytes: 1000, keepMs: REPLAY_KEEP_MS, nearBytes: 100},
  );
  assert.deepEqual(
    plan.remove.map(item => item.id).sort(),
    ['old', 'verified'],
  );
  assert.equal(plan.keep.length, 1);
  assert.match(plan.problem, /over/);
  const near = planCopies(
    [{id: 'keep', bytes: 800, takenMs: young, verified: false}],
    now,
    {capBytes: 1000, keepMs: REPLAY_KEEP_MS, nearBytes: 300},
  );
  assert.equal(near.remove.length, 0);
  assert.match(near.problem, /close to/);
  const room = planCopies(
    [{id: 'keep', bytes: 100, takenMs: young, verified: false}],
    now,
    {capBytes: 1000, keepMs: REPLAY_KEEP_MS, nearBytes: 300},
  );
  assert.equal(room.problem, null);
});

test('a closed capture with a gap gets its own copy, and a quiet one gets nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'replay-safety-'));
  try {
    const captureRoot = join(root, 'lap-capture');
    const replays = join(root, 'Replays');
    const copies = join(captureRoot, 'replays');
    mkdirSync(join(captureRoot, 'cap-1'), {recursive: true});
    writeFileSync(
      join(captureRoot, 'cap-1', 'meta.json'),
      JSON.stringify({gaps: 1}),
    );
    mkdirSync(replays, {recursive: true});
    const src = join(replays, 'race.Vcr');
    writeFileSync(src, 'replay-bytes');
    // birthtime is the folder's, not something we can set. Use the real birth.
    writeFileSync(src, 'replay-bytes');
    const outcome = await maintainReplayCopies({
      captureRoot,
      replaysRoot: copies,
      replayFolder: replays,
      closedDir: 'cap-1',
      nowMs: Date.now(),
      gameRunning: false,
      settleMs: 0,
      wait: async () => {},
    });
    assert.equal(outcome.hold, null);
    const linked = readFileSync(join(copies, 'cap-1', 'race.Vcr'), 'utf8');
    assert.equal(linked, 'replay-bytes');
    const doc = JSON.parse(readFileSync(join(copies, 'cap-1', 'copy.json'), 'utf8'));
    assert.equal(doc.file, 'race.Vcr');
    assert.equal(statSync(src).nlink, 1);
    assert.equal(statSync(join(copies, 'cap-1', 'race.Vcr')).nlink, 1);

    mkdirSync(join(captureRoot, 'cap-quiet'), {recursive: true});
    writeFileSync(join(captureRoot, 'cap-quiet', 'meta.json'), '{}');
    const quiet = await maintainReplayCopies({
      captureRoot,
      replaysRoot: copies,
      replayFolder: replays,
      closedDir: 'cap-quiet',
      nowMs: Date.now(),
      gameRunning: false,
      settleMs: 0,
      wait: async () => {},
    });
    assert.equal(quiet.hold, null);
    assert.equal(
      (() => {
        try {
          return readFileSync(join(copies, 'cap-quiet', 'copy.json'), 'utf8');
        } catch {
          return null;
        }
      })(),
      null,
    );
    // The game file is still there.
    assert.equal(readFileSync(src, 'utf8'), 'replay-bytes');
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('a copy that throws is tried three times, then a Problems line, and not again', async () => {
  const root = mkdtempSync(join(tmpdir(), 'replay-safety-'));
  try {
    const captureRoot = join(root, 'lap-capture');
    const replays = join(root, 'Replays');
    const copies = join(captureRoot, 'replays');
    mkdirSync(join(captureRoot, 'cap-1'), {recursive: true});
    writeFileSync(join(captureRoot, 'cap-1', 'meta.json'), JSON.stringify({lostChunks: 1}));
    mkdirSync(replays, {recursive: true});
    const src = join(replays, 'race.Vcr');
    writeFileSync(src, 'replay-bytes');
    let calls = 0;
    const copyFile = () => {
      calls += 1;
      throw new Error('disk full');
    };
    const args = {
      captureRoot,
      replaysRoot: copies,
      replayFolder: replays,
      closedDir: 'cap-1',
      nowMs: Date.now(),
      gameRunning: false,
      settleMs: 0,
      wait: async () => {},
      copyFile,
    };
    const first = await maintainReplayCopies(args);
    assert.equal(first.hold, 'cap-1');
    assert.equal(first.problem, null);
    const second = await maintainReplayCopies(args);
    assert.equal(second.hold, 'cap-1');
    assert.equal(second.problem, null);
    const third = await maintainReplayCopies(args);
    assert.equal(third.hold, null);
    assert.equal(third.problem.message, COPY_FAIL_MESSAGE);
    assert.equal(calls, COPY_TRIES);
    const again = await maintainReplayCopies(args);
    assert.equal(calls, COPY_TRIES);
    assert.equal(again.hold, null);
    assert.equal(again.problem.message, COPY_FAIL_MESSAGE);
    const later = await maintainReplayCopies({...args, closedDir: null});
    assert.equal(calls, COPY_TRIES);
    assert.equal(later.problem.message, COPY_FAIL_MESSAGE);
    assert.equal(readFileSync(src, 'utf8'), 'replay-bytes');
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('a verified capture drops our copy and leaves the game file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'replay-safety-'));
  try {
    const captureRoot = join(root, 'lap-capture');
    const copies = join(captureRoot, 'replays');
    mkdirSync(join(captureRoot, 'cap-1'), {recursive: true});
    writeFileSync(
      join(captureRoot, 'cap-1', 'uploaded.json'),
      JSON.stringify({
        sessionIds: ['abc'],
        verified: {abc: {fieldHash: 'fff', laps: 2}},
      }),
    );
    mkdirSync(join(copies, 'cap-1'), {recursive: true});
    writeFileSync(join(copies, 'cap-1', 'race.Vcr'), 'ours');
    writeFileSync(
      join(copies, 'cap-1', 'copy.json'),
      JSON.stringify({v: 1, capture: 'cap-1', file: 'race.Vcr', bytes: 4, takenMs: now}),
    );
    const outcome = await maintainReplayCopies({
      captureRoot,
      replaysRoot: copies,
      replayFolder: join(root, 'none'),
      closedDir: null,
      nowMs: now,
      gameRunning: false,
      settleMs: 0,
      wait: async () => {},
    });
    assert.equal(outcome.problem, null);
    assert.equal(
      (() => {
        try {
          return readFileSync(join(copies, 'cap-1', 'race.Vcr'), 'utf8');
        } catch {
          return null;
        }
      })(),
      null,
    );
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
