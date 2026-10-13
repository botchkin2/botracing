// Layer 2 of the contract gate (contract/README.md): the tray's real watcher
// replays a real capture as a live drive, against the API in the emulators,
// through the Hosting emulator's own /api rewrites. Fails on any request the
// API refused, any lap that does not land, and any heartbeat the watcher wrote
// that the contract refuses or that has a shape no real beat has.
//
//   node functions/test/replay/emulators.mjs -- node functions/test/replay/run.mjs --from <capture folder> [--laps 3] [--speed 4]
//
// Windows only: the watcher's lock and game check are the tray's (as liveE2E).
import {spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {newShape} from '../../../contract/payloads.mjs';
import {checkHeartbeat} from '../../src/contract/heartbeat.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const from = resolve(arg('--from', ''));
const laps = arg('--laps', '3');
const speed = arg('--speed', '4');
const api = process.env.REPLAY_API;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const problems = [];
const fail = why => problems.push(why);
if (!api || !authHost) {
  console.log(
    'FAIL: run through emulators.mjs (no REPLAY_API or auth emulator)',
  );
  process.exit(1);
}
if (!existsSync(join(from, 'meta.json'))) {
  console.log(`FAIL: no capture at ${from}`);
  process.exit(1);
}

// A user of the emulator's own Auth: its ID token is what the tray sends.
const signUp = await fetch(
  `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`,
  {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({returnSecureToken: true}),
  },
);
const {idToken} = await signUp.json();
const tokenFile = join(mkdtempSync(join(tmpdir(), 'replay-token-')), 'token');
writeFileSync(tokenFile, idToken);

// The drive, by liveE2E itself (the release gate's own harness).
const run = spawn(
  process.execPath,
  [
    join(repo, 'tools/dev/liveE2E.mjs'),
    '--from',
    from,
    '--token',
    tokenFile,
    '--no-screen',
    '--laps',
    laps,
    '--speed',
    speed,
  ],
  {
    env: {
      ...process.env,
      LAP_API: `${api}/api/upload`,
      LAP_API_BASE: api,
    },
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
if (!scratch) fail('no scratch folder in the liveE2E output');
else {
  const home = join(scratch, 'home');
  // Every refusal the watcher logged. A 429 is the server's own pacing and
  // fine only when the sender waited as told (heartbeatSender honours
  // Retry-After; its tests prove the wait), so only other codes fail.
  const log = readFileSync(join(home, 'watch.log'), 'utf8');
  for (const line of log.split(/\r?\n/))
    if (/\b(HTTP|status) [45]\d\d\b/.test(line) && !/\b429\b/.test(line))
      fail(`refused: ${line.trim()}`);
  // Every beat this run wrote, through the contract and against real shapes.
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
  // The replay's own status.json must look like the recorder's.
  const status = JSON.parse(
    readFileSync(join(scratch, 'capture', 'status.json'), 'utf8'),
  );
  const statusFresh = newShape('recorder-status', status);
  if (statusFresh.length)
    fail(
      `the replay's status.json is not the recorder's: ${statusFresh.join(
        ', ',
      )}`,
    );
  console.log(`${n} heartbeats checked`);
}

for (const p of problems) console.log(`FAIL: ${p}`);
console.log(
  problems.length ? 'FAIL: contract replay' : 'PASS: contract replay',
);
process.exit(problems.length ? 1 : 0);
