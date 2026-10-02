// End to end: the real watch.mjs (one tick, --once) against a fixture telemetry
// folder and a stand-in sync script. No Firestore, no game, no real watcher:
// the seams are LAP_SYNC_SCRIPT, LAP_HEARTBEAT_FILE, LAP_LOCK_PIPE,
// LAP_GAME_EXE and LOCALAPPDATA (watch.mjs). Windows only: the lock is a named
// pipe and the game check is tasklist.
// Run: node --test tools/uploader/watch.e2e.test.mjs
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {after, before, test} from 'node:test';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const watch = resolve(here, 'watch.mjs');
const windows = process.platform === 'win32';

// What sync.mjs prints for a clean pass, and for a crash before its closing
// line (the #223 shape: an uncaught RangeError, exit 1).
const fakeSync = `
if (process.env.FAKE_SYNC === 'crash') {
  console.log('to do 1');
  console.error('file:///x/sync.mjs:120');
  console.error('');
  console.error('RangeError: Maximum call stack size exceeded');
  console.error('    at staleRev (file:///x/sync.mjs:120:7)');
  process.exit(1);
}
console.log('to do 1');
console.log('aaaaaaaaaaaaaaaa 2026-10-01T20:00 Race       Road Atlanta | 911 | 1 file(s)');
console.log('  22 laps, 20 comparable, best 80.1');
console.log('done 1, failed 0, unchanged 0');
`;

let root;
let local;
let telemetry;
let beatsPath;
let statePath;
let syncPath;

before(() => {
  root = mkdtempSync(resolve(tmpdir(), 'lap-watch-e2e-'));
  local = resolve(root, 'local');
  telemetry = resolve(root, 'telemetry');
  beatsPath = resolve(root, 'beats.jsonl');
  statePath = resolve(local, 'lap-uploader', 'state.json');
  syncPath = resolve(root, 'fake-sync.mjs');
  mkdirSync(telemetry, {recursive: true});
  writeFileSync(syncPath, fakeSync);
  // One recording, written an hour ago, as the game leaves it.
  const file = resolve(telemetry, 'session1.duckdb');
  writeFileSync(file, 'x');
  const old = new Date(Date.now() - 3600 * 1000);
  utimesSync(file, old, old);
});

after(() => rmSync(root, {recursive: true, force: true}));

// One watcher tick. Returns the heartbeat docs it wrote, in order.
function tick(fake) {
  writeFileSync(beatsPath, '');
  const r = spawnSync(process.execPath, [watch, '--once'], {
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      LOCALAPPDATA: local,
      LMU_TELEMETRY: telemetry,
      LAP_SYNC_SCRIPT: syncPath,
      LAP_HEARTBEAT_FILE: beatsPath,
      LAP_LOCK_PIPE: String.raw`\\.\pipe\lap-uploader-watch-e2e-${process.pid}`,
      // No such process: the game is never running.
      LAP_GAME_EXE: 'lap-e2e-no-such-game.exe',
      FAKE_SYNC: fake,
    },
  });
  assert.equal(r.status, 0, r.stderr);
  return readFileSync(beatsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

const readState = () => JSON.parse(readFileSync(statePath, 'utf8'));

test(
  'a new recording runs a sync and the heartbeat ends waiting for the game',
  {skip: !windows},
  () => {
    const beats = tick('ok');
    assert.ok(beats.some(b => b.state === 'syncing'));
    const last = beats[beats.length - 1];
    assert.equal(last.state, 'waiting-for-game');
    assert.equal(last.lmuFound, true);
    assert.equal(last.sessionsDone, 1);
    assert.equal(last.lastSessionId, 'aaaaaaaaaaaaaaaa');
    assert.ok(last.lastUploadAt);
    assert.equal(last.lastError, null);
    assert.equal(last.queue, 0);
    const state = readState();
    assert.ok(state.lastRunAtMs);
    assert.equal(state.retryAtMs, null);
  },
);

test(
  'nothing new: the next tick runs no sync',
  {skip: !windows},
  () => {
    const beats = tick('crash'); // would crash if a sync ran
    assert.ok(!beats.some(b => b.state === 'syncing'));
    assert.equal(beats[beats.length - 1].state, 'waiting-for-game');
  },
);

test(
  'a sync that crashes before its closing line shows "sync crashed" and waits',
  {skip: !windows},
  () => {
    // New telemetry newer than the last run.
    writeFileSync(resolve(telemetry, 'session2.duckdb'), 'y');
    const beats = tick('crash');
    const last = beats[beats.length - 1];
    assert.equal(last.state, 'error');
    assert.equal(
      last.lastError.message,
      'sync crashed: RangeError: Maximum call stack size exceeded',
    );
    assert.ok(last.lastError.at);
    const state = readState();
    assert.equal(state.failuresInRow, 1);
    assert.ok(state.retryAtMs > Date.now());
    // The crashed run is not recorded as done: the version and run time stay.
    assert.equal(last.sessionsDone, 1);
  },
);

test(
  'before its retry time the crashed sync is not run again',
  {skip: !windows},
  () => {
    const beats = tick('ok');
    assert.ok(!beats.some(b => b.state === 'syncing'));
    const last = beats[beats.length - 1];
    assert.equal(last.state, 'error');
    assert.match(last.lastError.message, /^sync crashed: RangeError/);
  },
);

test(
  'once the retry is due the sync runs again and the error clears',
  {skip: !windows},
  () => {
    const state = readState();
    writeFileSync(
      statePath,
      JSON.stringify({...state, retryAtMs: Date.now() - 1000}),
    );
    const beats = tick('ok');
    assert.ok(beats.some(b => b.state === 'syncing'));
    const last = beats[beats.length - 1];
    assert.equal(last.state, 'waiting-for-game');
    assert.equal(last.lastError, null);
    assert.equal(last.sessionsDone, 2);
    const settled = readState();
    assert.equal(settled.retryAtMs, null);
    assert.equal(settled.failuresInRow, 0);
  },
);
