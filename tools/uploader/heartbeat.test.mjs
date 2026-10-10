// Run: node --test tools/uploader/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  beatKey,
  heartbeatDoc,
  hostIdOf,
  idleState,
  MAX_PROBLEMS,
  problemsOf,
  scrub,
} from './heartbeat.mjs';

const nowMs = Date.parse('2026-09-29T10:00:00Z');
const input = {
  hostId: hostIdOf('BOTKIN-PC'),
  label: 'Race PC',
  version: 'abc1234',
  lmuFound: true,
  state: 'waiting-for-game',
  watch: {
    lastUploadAt: '2026-09-29T09:00:00.000Z',
    lastSessionId: '9f0ea4efff1d692b',
    sessionsDone: 3,
  },
  queue: 0,
  freeBytes: 500e9,
  recorder: {
    state: 'recording',
    gameVersion: '1.2.3',
    layoutOk: true,
    lastChunkAt: '2026-09-29T09:59:30Z',
    captureBytes: 123,
    updatedAt: '2026-09-29T09:59:40Z',
  },
  nowMs,
};

test('matches the contract the app reads', () => {
  const doc = heartbeatDoc(input);
  assert.match(doc.hostId, /^[0-9a-f]{8}$/);
  assert.equal(doc.label, 'Race PC');
  assert.ok(!JSON.stringify(doc).includes('BOTKIN'));
  assert.equal(doc.lastSeenAt, '2026-09-29T10:00:00.000Z');
  assert.deepEqual(doc.disk, {captureBytes: 123, freeBytes: 500e9});
  assert.equal(doc.recorder.state, 'recording');
  assert.equal(doc.recorder.updatedAt, '2026-09-29T09:59:40Z');
  assert.equal(doc.lastError, null);
});

test('a recorder status older than 2 minutes reads as not running', () => {
  const doc = heartbeatDoc({
    ...input,
    recorder: {...input.recorder, updatedAt: '2026-09-29T09:57:00Z'},
  });
  assert.equal(doc.recorder.state, 'not-running');
});

test('no recorder installed is null, not an error', () => {
  const doc = heartbeatDoc({...input, recorder: null});
  assert.equal(doc.recorder, null);
  assert.equal(doc.disk.captureBytes, 0);
});

test('the time alone does not force a write', () => {
  assert.equal(
    beatKey(heartbeatDoc(input)),
    beatKey(heartbeatDoc({...input, nowMs: nowMs + 60000})),
  );
  assert.notEqual(
    beatKey(heartbeatDoc(input)),
    beatKey(heartbeatDoc({...input, state: 'syncing'})),
  );
});

test('an error reaches the doc as one line with no user paths', () => {
  const message =
    "failed: ENOENT 'C:\\Users\\Botkin\\AppData\\Local\\x.parquet'\n    at stack line";
  assert.equal(scrub(message), "failed: ENOENT '~\\AppData\\Local\\x.parquet'");
  assert.equal(scrub('open C:/Users/Botkin/x failed'), 'open ~/x failed');
  const doc = heartbeatDoc({
    ...input,
    watch: {lastError: {at: 'x', message, path: 'lap-uploader/watch.log'}},
  });
  assert.ok(!doc.lastError.message.includes('Botkin'));
});

test('progress reaches the doc, and a step forward forces a write', () => {
  assert.equal(heartbeatDoc(input).progress, null);
  const at = done =>
    heartbeatDoc({...input, state: 'syncing', progress: {done, total: 300}});
  assert.deepEqual(at(12).progress, {done: 12, total: 300});
  assert.notEqual(beatKey(at(12)), beatKey(at(13)));
});

test('a pending retry shows its time, and changes the beat key', () => {
  const retryAtMs = Date.parse('2026-09-29T10:30:00Z');
  const doc = heartbeatDoc({...input, state: 'retrying', retryAtMs});
  assert.equal(doc.retryAt, '2026-09-29T10:30:00.000Z');
  assert.equal(heartbeatDoc(input).retryAt, null);
  assert.notEqual(beatKey(doc), beatKey(heartbeatDoc(input)));
});

test('idle state: crash, then in game, then retrying, then waiting', () => {
  const s = {crashed: false, gameRunning: false, retryPending: false};
  assert.equal(idleState(s), 'waiting-for-game');
  assert.equal(idleState({...s, retryPending: true}), 'retrying');
  assert.equal(
    idleState({...s, retryPending: true, gameRunning: true}),
    'in-game',
  );
  assert.equal(idleState({...s, retryPending: true, crashed: true}), 'error');
});

test('the fold phase is part of the beat key, so a new phase writes at once', () => {
  const sessions = heartbeatDoc({...input, progress: {done: 13, total: 13}});
  const fold = heartbeatDoc({
    ...input,
    progress: {done: 13, total: 13, phase: 'surface'},
  });
  assert.notEqual(beatKey(sessions), beatKey(fold));
  assert.equal(fold.progress.phase, 'surface');
});

const MIN = 60_000;

test('problems: a crashed sync, each session on a retry, a stopped recorder, newest first', () => {
  const problems = problemsOf({
    sims: [
      {
        lastError: {
          at: '2026-09-29T09:50:00.000Z',
          message: 'sync crashed: RangeError: x',
        },
        retryAtMs: nowMs + 30 * MIN,
        retries: {
          aaaaaaaaaaaaaaaa: {
            failures: 3,
            atMs: nowMs + 60 * MIN,
            lastAtMs: nowMs - 5 * MIN,
            message: 'HTTP 413 at C:\\Users\\Botkin\\x.json\nstack',
          },
        },
      },
    ],
    recorder: {
      ...input.recorder,
      layoutOk: false,
      layoutReason: 'struct size 1234 != 1240',
    },
    nowMs,
  });
  assert.deepEqual(
    problems,
    [
      {
        kind: 'session-failed',
        at: '2026-09-29T09:55:00.000Z',
        message: 'HTTP 413 at ~\\x.json',
        sessionId: 'aaaaaaaaaaaaaaaa',
        count: 3,
        retryAt: '2026-09-29T11:00:00.000Z',
      },
      {
        kind: 'sync-crashed',
        at: '2026-09-29T09:50:00.000Z',
        message: 'sync crashed: RangeError: x',
        retryAt: '2026-09-29T10:30:00.000Z',
      },
      {
        kind: 'recorder-layout',
        at: '2026-09-29T09:59:40Z',
        message: 'struct size 1234 != 1240',
      },
    ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
  );
});

test('problems: none when all is well; a finished sync with an old error is not a crash', () => {
  assert.deepEqual(
    problemsOf({sims: [{retries: {}}], recorder: input.recorder, nowMs}),
    [],
  );
  assert.deepEqual(
    problemsOf({
      sims: [
        {lastError: {at: 'x', message: 'old'}, retryAtMs: null, retries: {}},
      ],
      recorder: null,
      nowMs,
    }),
    [],
  );
});

test('problems: a token or an address in a failure message is redacted', () => {
  const problems = problemsOf({
    sims: [
      {
        retries: {
          '0000000000000001': {
            failures: 1,
            atMs: nowMs + MIN,
            lastAtMs: nowMs,
            message: 'bad eyJhbGciOi.eyJzdWIiOiIx.sig for a@b.example',
          },
        },
      },
    ],
    recorder: null,
    nowMs,
  });
  assert.equal(problems[0].message, 'bad <token> for <email>');
});

test('problems: at most 10, messages cut to 120 characters, and a change forces a beat', () => {
  const retries = {};
  for (let i = 0; i < 15; i += 1)
    retries[String(i).padStart(16, '0')] = {
      failures: 1,
      atMs: nowMs + MIN,
      lastAtMs: nowMs - i * MIN,
      message: 'x'.repeat(200),
    };
  const problems = problemsOf({sims: [{retries}], recorder: null, nowMs});
  assert.equal(problems.length, MAX_PROBLEMS);
  assert.equal(problems[0].sessionId, '0000000000000000', 'newest first');
  assert.equal(problems[0].message.length, 120);
  assert.notEqual(
    beatKey(heartbeatDoc(input)),
    beatKey(heartbeatDoc({...input, problems})),
  );
  assert.deepEqual(heartbeatDoc({...input, problems}).problems, problems);
  assert.deepEqual(heartbeatDoc(input).problems, []);
});
