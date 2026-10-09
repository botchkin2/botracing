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
      LAP_SIMS: 'lmu',
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

test('nothing new: the next tick runs no sync', {skip: !windows}, () => {
  const beats = tick('crash'); // would crash if a sync ran
  assert.ok(!beats.some(b => b.state === 'syncing'));
  assert.equal(beats[beats.length - 1].state, 'waiting-for-game');
});

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

test(
  'under the tray (a token file) the status also goes to the server: bearer token, no owner in the body, a 429 is survived',
  {skip: !windows},
  async () => {
    const {createServer} = await import('node:http');
    const {spawn} = await import('node:child_process');
    const posts = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        posts.push({
          url: req.url,
          auth: req.headers.authorization,
          body: JSON.parse(body),
        });
        res.writeHead(posts.length === 1 ? 429 : 204, {'retry-after': '1'});
        res.end();
      });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const tokenFile = resolve(root, 'token');
    writeFileSync(tokenFile, 'tok-e2e\n');
    writeFileSync(beatsPath, '');
    const state = readState();
    writeFileSync(
      statePath,
      JSON.stringify({...state, lastRunAtMs: 0, retryAtMs: null}),
    );
    const child = spawn(process.execPath, [watch, '--once'], {
      env: {
        ...process.env,
        LOCALAPPDATA: local,
        LMU_TELEMETRY: telemetry,
        LAP_SYNC_SCRIPT: syncPath,
        LAP_HEARTBEAT_FILE: beatsPath,
        LAP_TOKEN_FILE: tokenFile,
        LAP_API: `http://127.0.0.1:${server.address().port}/api/upload`,
        LAP_LOCK_PIPE: String.raw`\\.\pipe\lap-uploader-watch-e2e-http-${process.pid}`,
        LAP_GAME_EXE: 'lap-e2e-no-such-game.exe',
        LAP_SIMS: 'lmu',
        FAKE_SYNC: 'ok',
      },
      stdio: 'ignore',
    });
    const code = await new Promise(r => child.on('close', r));
    server.close();
    assert.equal(code, 0);
    assert.ok(posts.length >= 1, 'a status was posted');
    assert.equal(posts[0].url, '/api/upload/heartbeat');
    assert.equal(posts[0].auth, 'Bearer tok-e2e');
    assert.equal(posts[0].body.state, 'syncing');
    assert.equal('ownerId' in posts[0].body, false);
    assert.equal('lastSeenAt' in posts[0].body, false);
    assert.match(posts[0].body.hostId, /^[0-9a-f]{8}$/);
  },
);

// iRacing: the watcher runs `sync --sim iracing` with a work folder of its
// own, and never for the LMU folder's recordings.
test(
  'a new .ibt runs a sync for iRacing, with its own work folder',
  {skip: !windows},
  () => {
    const ibtDir = resolve(root, 'ibt');
    const calls = resolve(root, 'sync-calls.txt');
    const echoSync = resolve(root, 'echo-sync.mjs');
    mkdirSync(ibtDir, {recursive: true});
    const ibt = resolve(ibtDir, 'mustang_roadatlanta 2026-10-01.ibt');
    writeFileSync(ibt, 'x');
    const old = new Date(Date.now() - 3600 * 1000);
    utimesSync(ibt, old, old);
    writeFileSync(
      echoSync,
      `import {appendFileSync} from 'node:fs';
appendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(' ') + '\\n');
console.log('to do 1');
console.log('bbbbbbbbbbbbbbbb 2026-10-01T20:00 Race       Road Atlanta | Mustang | 1 file(s)');
console.log('done 1, failed 0, unchanged 0');
`,
    );
    writeFileSync(beatsPath, '');
    const r = spawnSync(
      process.execPath,
      [watch, '--once', '--', '--work', resolve(local, 'sessions')],
      {
        encoding: 'utf8',
        timeout: 120_000,
        env: {
          ...process.env,
          LOCALAPPDATA: resolve(root, 'local-ir'),
          LAP_SIMS: 'iracing',
          IRACING_TELEMETRY: ibtDir,
          LAP_SYNC_SCRIPT: echoSync,
          LAP_HEARTBEAT_FILE: beatsPath,
          LAP_LOCK_PIPE: String.raw`\\.\pipe\lap-uploader-watch-e2e-ir-${process.pid}`,
          LAP_GAME_EXE: 'lap-e2e-no-such-game.exe',
        },
      },
    );
    assert.equal(r.status, 0, r.stderr);
    const lines = readFileSync(calls, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /--sim iracing$/);
    assert.match(lines[0], /--work \S*sessions[\\/]iracing /);
    assert.ok(!lines[0].includes('--quiet-min'), lines[0]);
    const beats = readFileSync(beatsPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
    assert.equal(beats[beats.length - 1].sessionsDone, 1);
  },
);
