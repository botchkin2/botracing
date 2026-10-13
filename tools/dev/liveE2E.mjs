// Live laps end to end without a driver (pit-wall thread 66): a real capture
// replayed lap by lap (replayCapture.mjs), the uploader's own watcher running
// as seat-test against the production API with LMU "running", and the time
// from each lap reaching the disk to the session's lap count showing it.
//
//   node tools/dev/liveE2E.mjs --from <capture folder> --token <seat-test ID token file> --custom-token <seat-test custom token file> [--laps 4] [--speed 1] [--max-lap-s 15]
//
// Exits 1, the release gate's fail, when a lap never reaches the app or takes
// more than --max-lap-s from the disk to the session's lap count, or when the
// open pane's screen does not show it within the same limit (liveGate.mjs).
// The pane is opened once on the session and never reloaded: the screen must
// refresh by itself, as Botkin's does.
//
// Scratch folders only: nothing of the real tray, capture or uploader is touched.
import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {liveVerdict, screenLapCount} from './liveGate.mjs';
import {openPane} from './livePane.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const from = resolve(arg('--from', ''));
const token = resolve(arg('--token', ''));
const laps = Number(arg('--laps', '4'));
const speed = arg('--speed', '1');
const maxLapS = Number(arg('--max-lap-s', '15'));
// The screen check: a headless pane signed in as seat-test (a custom token from
// functions/scripts/mintTestToken.mjs --custom-token-file) opens the live
// session, and each lap must show on the screen within the limit too. Without
// the token the gate fails, unless --no-screen says it is skipped (which the
// release gate does not accept).
const customToken = arg('--custom-token', '')
  ? resolve(arg('--custom-token', ''))
  : '';
const noScreen = process.argv.includes('--no-screen');
if (!customToken && !noScreen) {
  console.log(
    'FAIL: --custom-token <file> is needed for the screen check (--no-screen skips it; the release gate does not accept that)',
  );
  process.exit(1);
}
const api = process.env.LAP_API_BASE || 'https://botracing-61.web.app';

const root = mkdtempSync(resolve(tmpdir(), 'live-e2e-'));
const dirs = Object.fromEntries(
  ['capture', 'telemetry', 'iracing', 'home', 'work'].map(d => {
    const p = resolve(root, d);
    mkdirSync(p, {recursive: true});
    return [d, p];
  }),
);
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(7)} s`;

// The watcher, as the tray runs it, with LMU "running" (node.exe always is).
const watcher = spawn(
  process.execPath,
  [
    resolve(here, '../uploader/watch.mjs'),
    '--',
    '--remote',
    '--work',
    dirs.work,
  ],
  {
    env: {
      ...process.env,
      LAP_CAPTURE: dirs.capture,
      LMU_TELEMETRY: dirs.telemetry,
      IRACING_TELEMETRY: dirs.iracing,
      LAP_UPLOADER_HOME: dirs.home,
      LAP_TOKEN_FILE: token,
      LAP_HEARTBEAT_FILE: resolve(dirs.home, 'heartbeat.jsonl'),
      LAP_LOCK_PIPE: String.raw`\\.\pipe\live-e2e-` + process.pid,
      LAP_GAME_EXE: 'node.exe',
      LAP_SIMS: 'lmu',
      // The watcher ends with this script (parentGuard.mjs), even if it is killed.
      LAP_PARENT_PID: String(process.pid),
    },
    windowsHide: true,
  },
);
let sessionId = null;
watcher.stdout.setEncoding('utf8').on('data', () => {});
const watchLog = resolve(dirs.home, 'watch.log');

// The drive, lap by lap at real speed.
const lapAt = [];
const replay = spawn(
  process.execPath,
  [
    resolve(here, 'replayCapture.mjs'),
    '--from',
    from,
    '--out',
    dirs.capture,
    '--speed',
    speed,
    '--laps',
    String(laps),
  ],
  {windowsHide: true},
);
replay.stdout.setEncoding('utf8').on('data', chunk => {
  for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
    if (line.includes('lap on disk')) {
      lapAt.push(Date.now());
      console.log(`${stamp()} lap ${lapAt.length} on disk`);
    }
  }
});

const seen = new Map();
const onScreen = new Map();
let pane = null;
const poll = async () => {
  if (!sessionId) {
    try {
      const m = readFileSync(watchLog, 'utf8').match(
        /live: ([0-9a-f]{16}) \d+ laps/,
      );
      if (m) sessionId = m[1];
    } catch {
      // No log yet.
    }
    if (sessionId && !noScreen) {
      pane = await openPane({origin: api, customTokenFile: customToken});
      await pane.goto(`/session/${sessionId}`);
      console.log(`${stamp()} pane open on session ${sessionId}`);
    }
    return;
  }
  const res = await fetch(`${api}/api/sessions/${sessionId}`, {
    headers: {Authorization: `Bearer ${readFileSync(token, 'utf8').trim()}`},
  });
  if (!res.ok) return;
  const body = await res.json();
  const n = body.lapCount ?? 0;
  // Only an upload after the lap reached the disk counts: a rerun lands on the
  // same session (the capture's own clock names it), laps already stored.
  const updated = Date.parse(body.live?.updatedAt ?? '') || 0;
  for (let k = 1; k <= n && k <= lapAt.length; k++) {
    if (seen.has(k) || updated < lapAt[k - 1]) continue;
    seen.set(k, Date.now() - lapAt[k - 1]);
    console.log(
      `${stamp()} lap ${k} in the app ${(seen.get(k) / 1000).toFixed(
        1,
      )} s after the line (lapCount ${n}, best ${body.bestLapTime})`,
    );
  }
  // The screen is read after the API, in the same tick: a lap counts on the
  // screen only once the app has it, and the clock is not a tick behind.
  if (pane) {
    const shown = screenLapCount(await pane.text());
    for (let k = 1; shown != null && k <= shown && k <= lapAt.length; k++) {
      if (onScreen.has(k) || !seen.has(k)) continue;
      onScreen.set(k, Date.now() - lapAt[k - 1]);
      console.log(
        `${stamp()} lap ${k} on the screen ${(onScreen.get(k) / 1000).toFixed(
          1,
        )} s after the line (screen shows ${shown})`,
      );
    }
  }
};

const done = () => seen.size >= laps && (noScreen || onScreen.size >= laps);
const until = Date.now() + (laps * 100_000) / Number(speed) + 180_000;
while (Date.now() < until && !done()) {
  await new Promise(r => setTimeout(r, 2000));
  await poll().catch(err => console.log(`${stamp()} poll: ${err.message}`));
}
if (pane) await pane.close();
watcher.kill();
replay.kill();
const ms = [...seen.values()].sort((a, b) => a - b);
console.log(
  `session ${sessionId}; laps in the app ${seen.size}/${laps}; latency s: ${ms
    .map(v => (v / 1000).toFixed(1))
    .join(' ')}`,
);
console.log(`scratch: ${root} (watch.log in home/)`);
const verdicts = [liveVerdict({laps, latencyMs: seen, maxLapS})];
if (!noScreen) {
  const sm = [...onScreen.values()].sort((a, b) => a - b);
  console.log(
    `laps on the screen ${onScreen.size}/${laps}; latency s: ${sm
      .map(v => (v / 1000).toFixed(1))
      .join(' ')}`,
  );
  verdicts.push(
    liveVerdict({laps, latencyMs: onScreen, maxLapS, where: 'the screen'}),
  );
}
const problems = verdicts.flatMap(v => v.problems);
for (const p of problems) console.log(`FAIL: ${p}`);
const pass = problems.length === 0;
console.log(
  pass
    ? `PASS: ${laps} laps, each within ${maxLapS} s${
        noScreen ? ' (screen not checked)' : ' in the app and on the screen'
      }`
    : 'FAIL: live laps gate',
);
process.exit(pass ? 0 : 1);
