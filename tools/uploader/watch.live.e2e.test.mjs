// End to end: the real watch.mjs (one tick, --once) runs live laps for iRacing
// from the iRacing recorder's own status file, with that sim's sync arguments.
// The "game" is this node process (LAP_IRACING_EXE), the sync a stand-in that
// records its arguments. Windows only, as watch.e2e.test.mjs.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, resolve} from 'node:path';
import {after, before, test} from 'node:test';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const watch = resolve(here, 'watch.mjs');
const windows = process.platform === 'win32';

let root;
let local;
let capture;
let callsPath;
let syncPath;

before(() => {
  root = mkdtempSync(resolve(tmpdir(), 'lap-watch-live-'));
  local = resolve(root, 'local');
  capture = resolve(local, 'lap-capture');
  callsPath = resolve(root, 'calls.jsonl');
  syncPath = resolve(root, 'fake-sync.mjs');
  mkdirSync(capture, {recursive: true});
  mkdirSync(resolve(root, 'telemetry'), {recursive: true});
  writeFileSync(
    syncPath,
    `import {appendFileSync} from 'node:fs';
appendFileSync(${JSON.stringify(
      callsPath,
    )}, JSON.stringify(process.argv.slice(2)) + '\\n');
console.log('live: done 1');`,
  );
});

after(() => rmSync(root, {recursive: true, force: true}));

const status = body =>
  writeFileSync(resolve(capture, 'status-iracing.json'), JSON.stringify(body));

function tick() {
  const r = spawnSync(process.execPath, [watch, '--once'], {
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      ...process.env,
      LOCALAPPDATA: local,
      IRACING_TELEMETRY: resolve(root, 'telemetry'),
      LAP_SYNC_SCRIPT: syncPath,
      LAP_HEARTBEAT_FILE: resolve(root, 'beats.jsonl'),
      LAP_LOCK_PIPE: String.raw`\\.\pipe\lap-uploader-watch-live-${process.pid}`,
      // This node process: iRacing is running.
      LAP_IRACING_EXE: basename(process.execPath),
      LAP_SIMS: 'iracing',
    },
  });
  assert.equal(r.status, 0, r.stderr);
  const calls = existsSync(callsPath)
    ? readFileSync(callsPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse)
    : [];
  writeFileSync(callsPath, '');
  return calls;
}

test(
  "a lap on disk in the iRacing capture runs that sim's live sync once",
  {skip: !windows},
  () => {
    status({
      state: 'recording',
      sessionDir: 'cap-a',
      lastLapAt: '2026-10-12T20:00:00.000Z',
    });
    const [call, ...more] = tick();
    assert.equal(more.length, 0);
    assert.equal(call[call.indexOf('--sim') + 1], 'iracing');
    assert.equal(call[call.indexOf('--live') + 1], resolve(capture, 'cap-a'));
    // The same lap again: nothing to send.
    assert.deepEqual(tick(), []);
    // The next lap.
    status({
      state: 'recording',
      sessionDir: 'cap-a',
      lastLapAt: '2026-10-12T20:01:30.000Z',
    });
    assert.equal(tick().length, 1);
  },
);

test('the capture closing sends its last lap once', {skip: !windows}, () => {
  status({
    state: 'waiting',
    sessionDir: null,
    lastLapAt: '2026-10-12T20:01:30.000Z',
  });
  const calls = tick();
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0][calls[0].indexOf('--live') + 1],
    resolve(capture, 'cap-a'),
  );
  assert.deepEqual(tick(), []);
});

// A failed live upload (a network blip) is tried again within seconds, not at
// the next 30 s tick: the real watcher running, a stand-in sync that fails
// once and then succeeds (thread 1 #5006: a connect timeout held a lap 46 s).
test('a failed live upload is tried again within seconds', {skip: !windows}, async () => {
  const {spawn} = await import('node:child_process');
  const failOnce = resolve(root, 'fail-once.mjs');
  const flag = resolve(root, 'failed-once');
  const timesPath = resolve(root, 'times.jsonl');
  writeFileSync(
    failOnce,
    `import {appendFileSync, existsSync, writeFileSync} from 'node:fs';
appendFileSync(${JSON.stringify(timesPath)}, Date.now() + '\\n');
if (!existsSync(${JSON.stringify(flag)})) {
  writeFileSync(${JSON.stringify(flag)}, '1');
  console.error('fetch failed: ConnectTimeoutError');
  process.exit(1);
}
console.log('live: done 1');`,
  );
  status({
    state: 'recording',
    sessionDir: 'cap-retry',
    lastLapAt: '2026-10-12T21:00:00.000Z',
  });
  const child = spawn(process.execPath, [watch], {
    env: {
      ...process.env,
      LOCALAPPDATA: local,
      IRACING_TELEMETRY: resolve(root, 'telemetry'),
      LAP_SYNC_SCRIPT: failOnce,
      LAP_HEARTBEAT_FILE: resolve(root, 'beats-retry.jsonl'),
      LAP_LOCK_PIPE: String.raw`\\.\pipe\lap-uploader-watch-retry-${process.pid}`,
      LAP_IRACING_EXE: basename(process.execPath),
      LAP_SIMS: 'iracing',
    },
    stdio: 'ignore',
  });
  const runs = () =>
    existsSync(timesPath)
      ? readFileSync(timesPath, 'utf8').split('\n').filter(Boolean).map(Number)
      : [];
  try {
    const until = Date.now() + 60_000;
    while (runs().length < 2 && Date.now() < until)
      await new Promise(r => setTimeout(r, 500));
  } finally {
    child.kill();
  }
  const [first, second] = runs();
  assert.ok(second, 'the failed upload was never tried again');
  const gapS = (second - first) / 1000;
  // 5 s retry plus a 2 s status poll and the run's own start-up; a tick is 30 s.
  assert.ok(gapS < 15, `retried after ${gapS.toFixed(1)} s`);
});
