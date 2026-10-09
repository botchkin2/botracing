// End to end for the tray's own sync state (pit-wall thread 54): the real
// watch.mjs, one tick at a time, started the way the tray starts it (--work
// and --first-window-days after the "--"), against a fixture telemetry folder
// and a stand-in sync script. Windows only, like watch.e2e.test.mjs.
// Run: node --test tools/uploader/watch.tray.e2e.test.mjs
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
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
const DAY = 86_400_000;

let root;
let local;
let telemetry;
let work;
let beatsPath;
let syncPath;
let syncRuns;

before(() => {
  root = mkdtempSync(resolve(tmpdir(), 'lap-tray-e2e-'));
  local = resolve(root, 'local');
  telemetry = resolve(root, 'telemetry');
  work = resolve(local, 'BotRacing', 'sessions');
  beatsPath = resolve(root, 'beats.jsonl');
  syncPath = resolve(root, 'fake-sync.mjs');
  syncRuns = resolve(root, 'sync-runs.txt');
  mkdirSync(telemetry, {recursive: true});
  mkdirSync(work, {recursive: true});
  // The stand-in records its arguments, so a test can see what the watcher
  // started it with.
  writeFileSync(
    syncPath,
    `import {appendFileSync} from 'node:fs';
appendFileSync(${JSON.stringify(
      syncRuns,
    )}, process.argv.slice(2).join(' ') + '\\n');
console.log('to do 0');
console.log('done 0, failed 0, unchanged 0');
`,
  );
  const aged = (name, ageMs) => {
    const file = resolve(telemetry, name);
    writeFileSync(file, 'x');
    const t = new Date(Date.now() - ageMs);
    utimesSync(file, t, t);
  };
  aged('recent.duckdb', 3600 * 1000);
  aged('old.duckdb', 30 * DAY);
});

after(() => rmSync(root, {recursive: true, force: true}));

function tick(folder = telemetry, workDir = work, localDir = local) {
  writeFileSync(beatsPath, '');
  const r = spawnSync(
    process.execPath,
    [
      watch,
      '--once',
      '--',
      '--remote',
      '--work',
      workDir,
      '--first-window-days',
      '14',
    ],
    {
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        LOCALAPPDATA: localDir,
        LMU_TELEMETRY: folder,
        LAP_SYNC_SCRIPT: syncPath,
        LAP_HEARTBEAT_FILE: beatsPath,
        LAP_LOCK_PIPE: String.raw`\\.\pipe\lap-uploader-watch-tray-e2e-${process.pid}`,
        LAP_GAME_EXE: 'lap-e2e-no-such-game.exe',
      },
    },
  );
  assert.equal(r.status, 0, r.stderr);
  return readFileSync(beatsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

const runs = () =>
  readFileSync(syncRuns, 'utf8').split('\n').filter(Boolean).length;

test(
  'a fresh tray profile counts only the last 14 days as waiting, not the whole game folder',
  {skip: !windows},
  () => {
    const beats = tick();
    // The queue before the sync ran: recent.duckdb, not old.duckdb.
    assert.equal(beats[0].queue, 1);
    assert.equal(runs(), 1);
    const args = readFileSync(syncRuns, 'utf8');
    assert.match(args, /--work /);
    assert.ok(args.includes(work), args);
    assert.match(args, /--first-window-days 14/);
  },
);

test(
  'with the window in force and nothing new the next tick runs no sync',
  {skip: !windows},
  () => {
    tick();
    assert.equal(runs(), 1);
  },
);

test(
  '"Upload older sessions…" (the request file) runs one sync, even with nothing new',
  {skip: !windows},
  () => {
    writeFileSync(resolve(work, 'include-older'), '');
    const beats = tick();
    assert.ok(beats.some(b => b.state === 'syncing'));
    assert.equal(runs(), 2);
  },
);

// sync.mjs filters on the session's date, the watcher can only see file times.
// A recording touched later than it was made counts as waiting until a sync has
// described it; the sync skips it (outside the window) but its describe cache
// is saved, and from then on the watcher sees it as known: the queue drains.
test(
  'a recording touched after it was made does not stay in the queue once it has been described',
  {skip: !windows},
  () => {
    const folder2 = resolve(root, 'telemetry2');
    const work2 = resolve(root, 'work2');
    mkdirSync(folder2, {recursive: true});
    mkdirSync(work2, {recursive: true});
    const file = resolve(folder2, 'touched.duckdb');
    writeFileSync(file, 'x');
    const t = new Date(Date.now() - 3600 * 1000);
    utimesSync(file, t, t);
    // Before any sync it cannot be told from a new recording.
    const local2 = resolve(root, 'local2');
    assert.equal(tick(folder2, work2, local2)[0].queue, 1);
    // What sync.mjs saves after describing it and skipping it as too old.
    const {size, mtimeMs} = statSync(file);
    writeFileSync(
      resolve(work2, 'state.json'),
      JSON.stringify({
        files: {
          'touched.duckdb': {
            size,
            mtimeMs,
            info: {recordedAt: '2026-08-01T20:00:00Z'},
          },
        },
        sessions: {},
        owners: {},
        since: '2026-09-24',
      }),
    );
    // A fresh watcher again (no last run), so the queue reads the state's files.
    rmSync(resolve(local2, 'lap-uploader'), {recursive: true, force: true});
    const beats = tick(folder2, work2, local2);
    assert.equal(beats[0].queue, 0);
  },
);
