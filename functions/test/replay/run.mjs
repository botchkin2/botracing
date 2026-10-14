// Layer 2 of the contract gate (contract/README.md): the tray's real watcher
// against the API in the emulators, through the Hosting emulator's own /api
// rewrites, on real recordings. Two paths, as a drive reaches the API:
//
//   --live <capture folder>  a capture replayed lap by lap as a live drive
//                            (by liveE2E itself, the release gate's harness)
//   --file <game file>       a finished LMU .duckdb or iRacing .ibt, as the
//                            sim leaves it when the session ends
//
// Each is its own user. Fails on any request the API refused, any lap that
// does not land, and any heartbeat the watcher wrote that the contract
// refuses or that has a shape no real beat has.
//
//   node functions/test/replay/emulators.mjs -- functions/test/replay/run.mjs --live <dir> --file <a.duckdb> --file <b.ibt>
//
// Windows only: the watcher's lock and game check are the tray's.
import {spawn} from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {newShape} from '../../../contract/payloads.mjs';
import {checkHeartbeat} from '../../src/contract/heartbeat.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
// From emulators.mjs (REPLAY_ARGV), else the command line.
const argv = process.env.REPLAY_ARGV
  ? JSON.parse(process.env.REPLAY_ARGV)
  : process.argv.slice(2);
const all = name => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : []));
const arg = (name, fallback) => all(name)[0] ?? fallback;
const laps = Number(arg('--laps', '3'));
const speed = arg('--speed', '4');
const api = process.env.REPLAY_API;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const problems = [];
if (!api || !authHost) {
  console.log(
    'FAIL: run through emulators.mjs (no REPLAY_API or auth emulator)',
  );
  process.exit(1);
}

// A user of the emulator's own Auth: its ID token is what the tray sends.
async function newUser() {
  const res = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({returnSecureToken: true}),
    },
  );
  const {idToken} = await res.json();
  const file = join(mkdtempSync(join(tmpdir(), 'replay-token-')), 'token');
  writeFileSync(file, idToken);
  return file;
}

/** What the watcher in `home` logged and sent, against the contract. */
function checkWatcher(what, home, fail) {
  // Every refusal the watcher logged. A 429 is the server's own pacing and
  // fine only when the sender waited as told (heartbeatSender honours
  // Retry-After; its tests prove the wait), so only other codes fail.
  const log = readFileSync(join(home, 'watch.log'), 'utf8');
  for (const line of log.split(/\r?\n/))
    if (/\b(HTTP|status) [45]\d\d\b/.test(line) && !/\b429\b/.test(line))
      fail(`refused: ${line.trim()}`);
  const beats = join(home, 'heartbeat.jsonl');
  let n = 0;
  for (const line of existsSync(beats)
    ? readFileSync(beats, 'utf8').split('\n').filter(Boolean)
    : []) {
    const {lastSeenAt: _stamped, ...body} = JSON.parse(line);
    n++;
    const r = checkHeartbeat(body);
    if (!r.ok) fail(`heartbeat refused: ${r.error}: ${line.slice(0, 200)}`);
    const fresh = newShape('heartbeat', body);
    if (fresh.length)
      fail(`heartbeat has what no real beat has: ${fresh.join(', ')}`);
  }
  if (n === 0) fail('the watcher wrote no heartbeat');
  console.log(`${what}: ${n} heartbeats checked`);
}

async function live(from) {
  const fail = why => problems.push(`live ${basename(from)}: ${why}`);
  if (!existsSync(join(from, 'meta.json'))) return fail('no capture there');
  const run = spawn(
    process.execPath,
    [
      join(repo, 'tools/dev/liveE2E.mjs'),
      '--from',
      from,
      '--token',
      await newUser(),
      '--no-screen',
      '--laps',
      String(laps),
      '--speed',
      speed,
    ],
    {
      env: {...process.env, LAP_API: `${api}/api/upload`, LAP_API_BASE: api},
      windowsHide: true,
    },
  );
  let out = '';
  run.stdout.setEncoding('utf8').on('data', c => {
    out += c;
    process.stdout.write(c);
  });
  run.stderr.setEncoding('utf8').on('data', c => process.stderr.write(c));
  const code = await new Promise(r => run.on('exit', r));
  if (code !== 0) fail(`liveE2E exited ${code}`);
  const scratch = out.match(/scratch: (.+?) \(watch\.log/)?.[1];
  if (!scratch) return fail('no scratch folder in the liveE2E output');
  checkWatcher(`live ${basename(from)}`, join(scratch, 'home'), fail);
  // The replay's own status.json must look like the recorder's.
  const status = JSON.parse(
    readFileSync(join(scratch, 'capture', 'status.json'), 'utf8'),
  );
  const fresh = newShape('recorder-status', status);
  if (fresh.length)
    fail(`the replay's status.json is not the recorder's: ${fresh.join(', ')}`);
}

async function file(path) {
  const fail = why => problems.push(`file ${basename(path)}: ${why}`);
  if (!existsSync(path)) return fail('no file there');
  const root = mkdtempSync(join(tmpdir(), 'replay-file-'));
  const dirs = Object.fromEntries(
    ['capture', 'telemetry', 'iracing', 'home', 'work'].map(d => {
      mkdirSync(join(root, d));
      return [d, join(root, d)];
    }),
  );
  // Where the sim leaves it: LMU's telemetry folder, or iRacing's.
  const into = path.endsWith('.ibt') ? dirs.iracing : dirs.telemetry;
  copyFileSync(path, join(into, basename(path)));
  const token = await newUser();
  const watcher = spawn(
    process.execPath,
    [
      join(repo, 'tools/uploader/watch.mjs'),
      '--',
      '--remote',
      '--work',
      dirs.work,
    ],
    {
      env: {
        ...process.env,
        LAP_API: `${api}/api/upload`,
        LAP_CAPTURE: dirs.capture,
        LMU_TELEMETRY: dirs.telemetry,
        IRACING_TELEMETRY: dirs.iracing,
        LAP_UPLOADER_HOME: dirs.home,
        LAP_TOKEN_FILE: token,
        LAP_HEARTBEAT_FILE: join(dirs.home, 'heartbeat.jsonl'),
        LAP_LOCK_PIPE: String.raw`\\.\pipe\replay-file-` + process.pid,
        // Neither sim runs: the session is over, the file is final.
        LAP_GAME_EXE: 'no-such-game.exe',
        LAP_IRACING_EXE: 'no-such-game.exe',
        LAP_PARENT_PID: String(process.pid),
      },
      windowsHide: true,
    },
  );
  watcher.stdout.on('data', () => {});
  // The watcher's own end of the sync, then the session as the app reads it.
  const until = Date.now() + 300_000;
  let done = null;
  while (Date.now() < until && !done) {
    await new Promise(r => setTimeout(r, 2000));
    const log = existsSync(join(dirs.home, 'watch.log'))
      ? readFileSync(join(dirs.home, 'watch.log'), 'utf8')
      : '';
    done = log.match(/sync: done (\d+), failed (\d+)/);
  }
  // A last beat after the sync, then stop.
  await new Promise(r => setTimeout(r, 2000));
  watcher.kill();
  if (!done) return fail('the sync did not finish within 5 min');
  if (done[2] !== '0' || done[1] === '0')
    fail(`the sync: done ${done[1]}, failed ${done[2]}`);
  // Every age: a fixture can be older than the list's default window.
  const res = await fetch(`${api}/api/sessions?age=36500`, {
    headers: {Authorization: `Bearer ${readFileSync(token, 'utf8')}`},
  });
  const {items = []} = res.ok ? await res.json() : {};
  const found = items.find(s => (s.lapCount ?? 0) > 0);
  if (!found)
    fail(`no session with laps in the API (GET /sessions ${res.status})`);
  else
    console.log(
      `file ${basename(path)}: session ${found.id}, ${found.lapCount} laps`,
    );
  checkWatcher(`file ${basename(path)}`, dirs.home, fail);
}

for (const from of all('--live')) await live(resolve(from));
for (const path of all('--file')) await file(resolve(path));
if (!all('--live').length && !all('--file').length)
  problems.push(
    'nothing to replay: --live <capture> and/or --file <game file>',
  );

for (const p of problems) console.log(`FAIL: ${p}`);
console.log(
  problems.length ? 'FAIL: contract replay' : 'PASS: contract replay',
);
process.exit(problems.length ? 1 : 0);
