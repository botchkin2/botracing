// Run: node --test tools/uploader/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  beatKey,
  heartbeatDoc,
  simsDoc,
  hostIdOf,
  idleState,
  MAX_PROBLEMS,
  problemsOf,
  scrub,
  updateWaitingOf,
} from './heartbeat.mjs';
import {mutate, payload} from '../../contract/payloads.mjs';

// The recorder's real status.json (contract/README.md), recording, fresh at nowMs.
const STATUS = [
  ['state', 'recording'],
  ['lastChunkAt', '2026-09-29T09:59:30Z'],
  ['updatedAt', '2026-09-29T09:59:40Z'],
].reduce(
  (s, [path, value]) => mutate(s, path, value),
  payload('recorder-status', '0.1.10-no-game'),
);

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
  recorder: STATUS,
  nowMs,
};

test('matches the contract the app reads', () => {
  const doc = heartbeatDoc(input);
  assert.match(doc.hostId, /^[0-9a-f]{8}$/);
  assert.equal(doc.label, 'Race PC');
  assert.ok(!JSON.stringify(doc).includes('BOTKIN'));
  assert.equal(doc.lastSeenAt, '2026-09-29T10:00:00.000Z');
  assert.deepEqual(doc.disk, {
    captureBytes: STATUS.captureBytes,
    freeBytes: 500e9,
  });
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
  // A name with a space is one folder, not 'Jane' plus a leaked 'Doe'.
  assert.equal(
    scrub("ENOENT 'C:\\Users\\Jane Doe\\AppData\\x'"),
    "ENOENT '~\\AppData\\x'",
  );
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
    recorder: mutate(
      mutate(mutate(input.recorder, 'state', 'refused'), 'layoutOk', false),
      'layoutReason',
      'struct size 1234 != 1240',
    ),
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

test('problems: a refused drive stays after the recorder leaves refused', () => {
  const problems = problemsOf({
    sims: [{retries: {}}],
    recorder: input.recorder,
    refusals: [
      {firstAtMs: nowMs - 90 * MIN, lastAtMs: nowMs - 60 * MIN, count: 145, reason: 'car 7 lap distance -1640.78'},
    ],
    nowMs,
  });
  assert.deepEqual(problems, [
    {
      kind: 'capture-missed',
      at: new Date(nowMs - 60 * MIN).toISOString(),
      message: 'Drive not recorded',
      count: 145,
    },
  ]);
});

test('problems: while the recorder shows the refusal itself, the kept one is not a second row', () => {
  const problems = problemsOf({
    sims: [{retries: {}}],
    recorder: mutate(mutate(mutate(input.recorder, 'state', 'refused'), 'layoutOk', false), 'layoutReason', 'x'),
    refusals: [{firstAtMs: nowMs - MIN, lastAtMs: nowMs, count: 2, reason: 'x'}],
    nowMs,
  });
  assert.deepEqual(problems.map(p => p.kind), ['recorder-layout']);
});

test('problems: a recorder that records what it doubts is capture-suspect, not stopped', () => {
  const problems = problemsOf({
    sims: [{retries: {}}],
    recorder: mutate(
      mutate(mutate(input.recorder, 'state', 'recording'), 'layoutOk', false),
      'layoutReason',
      '8 of 8 cars: lap distance',
    ),
    nowMs,
  });
  assert.deepEqual(problems.map(p => [p.kind, p.message]), [
    ['capture-suspect', '8 of 8 cars: lap distance'],
  ]);
});

test('problems: a session without a field is a row that opens the session', () => {
  const problems = problemsOf({
    sims: [{retries: {}}],
    recorder: input.recorder,
    noField: {
      '28dcbd413c5cf761': {endMs: nowMs - 60 * MIN, why: 'This drive was not recorded, so there are no other cars'},
    },
    nowMs,
  });
  assert.deepEqual(problems, [
    {
      kind: 'field-missing',
      at: new Date(nowMs - 60 * MIN).toISOString(),
      message: 'This drive was not recorded, so there are no other cars',
      sessionId: '28dcbd413c5cf761',
    },
  ]);
});

test('problems: low disk space is a line before the disk fails; a chunk the disk refused is a line when it does', () => {
  const refused = payload('recorder-status', '0.1.17-recording-write-error'); // a real status.json with writeError set
  const fine = mutate(refused, 'writeError', null);
  const low = problemsOf({sims: [{retries: {}}], recorder: fine, freeBytes: 12e9, nowMs});
  assert.deepEqual(low.map(p => [p.kind, p.message]), [['disk-low', '12 GB free; a 24 h race records about 13 GB']]);
  assert.deepEqual(problemsOf({sims: [{retries: {}}], recorder: fine, freeBytes: 400e9, nowMs}), []);
  const full = problemsOf({sims: [{retries: {}}], recorder: refused, freeBytes: 0.2e9, nowMs});
  assert.deepEqual(full.map(p => [p.kind, p.message]), [['disk-full', "can't write the capture: Access is denied. (os error 5)"]], 'the failure replaces the warning');
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

test('each sim has its own queue, and only the sim being synced has the progress', () => {
  const sims = simsDoc(
    [
      {id: 'lmu', queue: 0, retryAtMs: null, lastError: null},
      {id: 'iracing', queue: 5, retryAtMs: null, lastError: null},
    ],
    'iracing',
    {done: 2, total: 5},
  );
  assert.deepEqual(sims.lmu, {
    queue: 0,
    syncing: false,
    progress: null,
    retryAt: null,
    lastError: null,
  });
  assert.deepEqual(sims.iracing, {
    queue: 5,
    syncing: true,
    progress: {done: 2, total: 5},
    retryAt: null,
    lastError: null,
  });
  // Nothing syncing: nobody has progress, whatever the watcher last reported.
  assert.equal(
    simsDoc([{id: 'lmu', queue: 1}], null, {done: 1, total: 2}).lmu.progress,
    null,
  );
});

test('each sim keeps its own retry time and error, with user folders scrubbed', () => {
  const sims = simsDoc([
    {
      id: 'lmu',
      queue: 1,
      retryAtMs: Date.UTC(2026, 9, 9, 12),
      lastError: {
        at: '2026-10-09T11:00:00Z',
        message: String.raw`boom in C:SERSBOTKINX`,
      },
    },
    {id: 'iracing', queue: 0},
  ]);
  assert.equal(sims.lmu.retryAt, '2026-10-09T12:00:00.000Z');
  assert.ok(
    !sims.lmu.lastError.message.includes('Botkin'),
    sims.lmu.lastError.message,
  );
  assert.equal(sims.iracing.retryAt, null);
  assert.equal(sims.iracing.lastError, null);
});

test('the heartbeat carries the sims, and a change in one sim forces a write', () => {
  const sims = n =>
    simsDoc([
      {id: 'lmu', queue: n},
      {id: 'iracing', queue: 0},
    ]);
  const a = heartbeatDoc({...input, sims: sims(0)});
  assert.deepEqual(Object.keys(a.sims), ['lmu', 'iracing']);
  assert.notEqual(beatKey(a), beatKey(heartbeatDoc({...input, sims: sims(1)})));
  assert.deepEqual(
    heartbeatDoc(input).sims,
    {},
    'an old caller still gets a doc',
  );
});

test('problems: a recording the sync could not read is named by its file', () => {
  const problems = problemsOf({
    sims: [
      {
        retries: {},
        unreadable: [
          {
            name: 'fordmustanggt3_fuji gp 2026-10-04 10-52-05.ibt',
            why: 'has no samples',
            atMs: nowMs - MIN,
          },
        ],
      },
    ],
    recorder: null,
    nowMs,
  });
  assert.deepEqual(problems, [
    {
      kind: 'file-unreadable',
      at: new Date(nowMs - MIN).toISOString(),
      message: 'fordmustanggt3_fuji gp 2026-10-04 10-52-05.ibt: has no samples',
    },
  ]);
  // Nothing unreadable: no problem (a state from before this field has none).
  assert.deepEqual(
    problemsOf({sims: [{retries: {}}], recorder: null, nowMs}),
    [],
  );
});

test('an update waiting counts only when it is newer than the running tray (stale files never show a banner)', () => {
  const file = v => JSON.stringify({version: v});
  assert.equal(updateWaitingOf(file('0.1.12'), '0.1.11'), '0.1.12');
  assert.equal(updateWaitingOf(file('0.2.0'), '0.1.11'), '0.2.0');
  assert.equal(updateWaitingOf(file('0.1.11'), '0.1.11'), null);
  assert.equal(updateWaitingOf(file('0.1.10'), '0.1.11'), null);
  assert.equal(updateWaitingOf(file('0.1.12'), 'a1b2c3d'), null, 'a checkout reports a commit, not a version');
  assert.equal(updateWaitingOf('', '0.1.11'), null);
  assert.equal(updateWaitingOf('not json', '0.1.11'), null);
  assert.equal(updateWaitingOf(JSON.stringify({}), '0.1.11'), null);
});

test('the beat carries updateWaiting only when there is one', () => {
  const base = {hostId: 'h', label: 'PC', version: '0.1.11', lmuFound: false, state: 'idle', watch: {}, queue: 0, freeBytes: 1, recorder: null, nowMs: 0};
  assert.equal('updateWaiting' in heartbeatDoc(base), false);
  assert.equal(heartbeatDoc({...base, updateWaiting: '0.1.12'}).updateWaiting, '0.1.12');
  assert.notEqual(beatKey(heartbeatDoc(base)), beatKey(heartbeatDoc({...base, updateWaiting: '0.1.12'})));
});

test('a pre-release suffix is the same version, so it is never "newer" than its release', () => {
  const file = v => JSON.stringify({version: v});
  assert.equal(updateWaitingOf(file('0.1.12-rc.1'), '0.1.12'), null);
  assert.equal(updateWaitingOf(file('0.1.12-rc.1'), '0.1.11'), '0.1.12-rc.1');
});

test('the heal count rides the beat only once a heal happened', () => {
  assert.equal('healed' in heartbeatDoc({...input, nowMs}), false);
  const doc = heartbeatDoc({...input, watch: {...input.watch, healed: 2}, nowMs});
  assert.equal(doc.healed, 2);
  assert.notEqual(beatKey(doc), beatKey(heartbeatDoc({...input, nowMs})));
});
