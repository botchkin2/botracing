// The watcher's heartbeat as the server takes it (contract/README.md): the
// real sender code (heartbeat.mjs), fed the recorder's real status.json files,
// through the server's own contract. A body the server would refuse, or a key
// or type no real payload has (a tray writing something new: refresh the
// payloads), fails here.
// Run: node --test tools/uploader/
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  loadPayloads,
  mutate,
  newShape,
  payload,
} from '../../contract/payloads.mjs';
import {
  LABEL_MAX as SERVER_LABEL_MAX,
  LAYOUT_REASON_MAX as SERVER_LAYOUT_REASON_MAX,
  PROBLEM_MESSAGE_MAX as SERVER_PROBLEM_MESSAGE_MAX,
  checkHeartbeat,
} from '../../functions/src/contract/heartbeat.ts';

import {
  LABEL_MAX,
  LAYOUT_REASON_MAX,
  PROBLEM_MESSAGE_MAX,
  heartbeatDoc,
  problemsOf,
} from './heartbeat.mjs';
import {bodyOf} from './heartbeatSender.mjs';

// The watcher's own inputs, read off a real beat (what it had stored).
const REAL = payload('heartbeat', '0.1.10-waiting-for-game-rec-no-game');
const inputs = (recorder, nowMs) => ({
  hostId: REAL.hostId,
  label: REAL.label,
  version: REAL.version,
  lmuFound: REAL.lmuFound,
  state: REAL.state,
  watch: {
    lastUploadAt: REAL.lastUploadAt,
    lastSessionId: REAL.lastSessionId,
    sessionsDone: REAL.sessionsDone,
  },
  queue: REAL.queue,
  sims: REAL.sims,
  freeBytes: REAL.disk.freeBytes,
  recorder,
  nowMs,
});
// The recorder's status as the watcher reads it, fresh at nowMs.
const beatFor = (status, over = {}) => {
  const nowMs = Date.parse(status.updatedAt) + 1_000;
  return bodyOf(heartbeatDoc({...inputs(status, nowMs), ...over}));
};
const accepted = (body, what) => {
  const r = checkHeartbeat(body);
  assert.ok(r.ok, `${what}: ${r.ok ? '' : r.error}`);
  return r;
};

test('the sender cuts text to the lengths the server takes', () => {
  assert.equal(LABEL_MAX, SERVER_LABEL_MAX);
  assert.equal(LAYOUT_REASON_MAX, SERVER_LAYOUT_REASON_MAX);
  assert.equal(PROBLEM_MESSAGE_MAX, SERVER_PROBLEM_MESSAGE_MAX);
});

test('every real recorder status.json makes a beat the server accepts, of a shape real beats have', () => {
  const all = loadPayloads('recorder-status');
  assert.ok(all.length >= 1);
  for (const {name, body: status} of all) {
    const beat = beatFor(status);
    accepted(beat, name);
    assert.equal(beat.recorder.state, status.state, name);
    assert.deepEqual(
      newShape('heartbeat', beat),
      [],
      `${name}: the beat has a key or type no stored payload has; save a real beat of it in contract/payloads/heartbeat`,
    );
  }
});

test('the game version, as the recorder writes it, is accepted (#597)', () => {
  const [status] = loadPayloads('recorder-status');
  const [meta] = loadPayloads('capture-meta');
  for (const gameVersion of [0, meta.body.gameVersion, null])
    accepted(
      beatFor(mutate(status.body, 'gameVersion', gameVersion)),
      `gameVersion ${gameVersion}`,
    );
});

test('a recorder reason carrying an OS error with a user path is scrubbed and cut to fit', () => {
  const [status] = loadPayloads('recorder-status');
  // The shape of recorder.rs's "can't write" reason, with a long user path.
  const deep = 'x'.repeat(300);
  const reason = `can't write C:\\Users\\Someone\\AppData\\Local\\lap-capture\\${deep}: Access is denied. (os error 5)`;
  let s = mutate(status.body, 'layoutOk', false);
  s = mutate(s, 'layoutReason', reason);
  const beat = beatFor(s);
  accepted(beat, 'long reason');
  assert.ok(!beat.recorder.layoutReason.includes('Someone'));
  assert.ok(beat.recorder.layoutReason.length <= LAYOUT_REASON_MAX);
});

test('a label of any length or type from config.json is sent as one the server takes', () => {
  const [status] = loadPayloads('recorder-status');
  for (const label of ['L'.repeat(200), '', 42, null, undefined]) {
    const beat = beatFor(status.body, {label});
    accepted(beat, `label ${JSON.stringify(label)}`);
  }
});

test('free space the PC cannot read is sent as null and accepted', () => {
  const [status] = loadPayloads('recorder-status');
  accepted(beatFor(status.body, {freeBytes: null}), 'freeBytes null');
});

test('every problem the watcher reports is one the server takes', () => {
  const [status] = loadPayloads('recorder-status');
  const nowMs = Date.parse(status.body.updatedAt) + 1_000;
  const long = 'boom '.repeat(100);
  const problems = problemsOf({
    sims: [
      {
        retryAtMs: nowMs + 60_000,
        lastError: {
          at: status.body.updatedAt,
          message: `sync crashed: ${long}`,
        },
        unreadable: [{name: 'a.ibt', why: long, atMs: nowMs}],
        retries: {
          '4dda01bc58a237af': {
            failures: 2,
            lastAtMs: nowMs,
            atMs: nowMs + 60_000,
            message: `HTTP 413 ${long}`,
          },
        },
      },
    ],
    recorder: mutate(status.body, 'layoutOk', false),
    nowMs,
  });
  assert.deepEqual(problems.map(p => p.kind).sort(), [
    'file-unreadable',
    'recorder-layout',
    'session-failed',
    'sync-crashed',
  ]);
  accepted(beatFor(status.body, {problems}), 'problems');
});
