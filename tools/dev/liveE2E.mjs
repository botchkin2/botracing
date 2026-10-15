// Live laps end to end without a driver (pit-wall thread 66): a real capture
// replayed lap by lap (replayCapture.mjs), the uploader's own watcher running
// as seat-test against the production API with LMU "running", and the time
// from each lap reaching the disk to the session's lap count showing it.
//
//   node tools/dev/liveE2E.mjs --from <capture folder> --token <seat-test ID token file> --custom-token <seat-test custom token file> [--laps 4] [--speed 1] [--max-lap-s 60] [--pane-origin <app origin>]
//
// Exits 1, the release gate's fail, when a lap never reaches the app or takes
// more than --max-lap-s from the disk to the session's lap count, or when the
// open pane's screen does not show it within the same limit (liveGate.mjs).
// The pane is opened once on the session and never reloaded: the screen must
// refresh by itself, as Botkin's does.
//
// Scratch folders only: nothing of the real tray, capture or uploader is touched.
import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {liveVerdict, screenLapCount} from './liveGate.mjs';
import {openPane} from './livePane.mjs';
import {seatSession} from './seatSession.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const from = resolve(arg('--from', ''));
// CI (roadmap 2w): --refresh-token <file> holds seat-test's refresh token, the
// only credential there. It gives the watcher and the API polls an ID token
// (written to the scratch folder) and the panes a signed-in session
// (seatSession.mjs), so neither --token nor --custom-token is needed.
const refreshTokenFile = arg('--refresh-token', '');
const session = refreshTokenFile
  ? await seatSession({refreshToken: readFileSync(resolve(refreshTokenFile), 'utf8')})
  : null;
// The watcher the release ships (roadmap 2w): the installed tray's own node and
// app folder, not this checkout's (--node <node.exe> --app <install>\app).
const nodeExe = arg('--node', process.execPath);
const appDir = arg('--app', '') ? resolve(arg('--app', '')) : resolve(here, '../..');
const laps = Number(arg('--laps', '4'));
const speed = arg('--speed', '1');
// A lap is well over a minute: 60 s from the line to the app and the screen is
// the limit (Botkin, 2026-10-15: "Yes, raise the live-lap test limit to 60 s.").
// 0.1.11 measured 10.7-12.3 s on the screen (run 38662560290).
const maxLapS = Number(arg('--max-lap-s', '60'));
// The Sessions list learns of a drive from the uploader signal (one /uploaders
// call a minute), not a poll of its own: its limit is 75 s, apart from the laps'.
const maxListS = Number(arg('--max-list-s', '75'));
// The screen check: a headless pane signed in as seat-test (a custom token from
// functions/scripts/mintTestToken.mjs --custom-token-file) opens the live
// session, and each lap must show on the screen within the limit too. Without
// the token the gate fails, unless --no-screen says it is skipped (which the
// release gate does not accept).
const customToken = arg('--custom-token', '')
  ? resolve(arg('--custom-token', ''))
  : '';
const noScreen = process.argv.includes('--no-screen');
if (!customToken && !session && !noScreen) {
  console.log(
    'FAIL: --custom-token <file> or --refresh-token <file> is needed for the screen check (--no-screen skips it; the release gate does not accept that)',
  );
  process.exit(1);
}
const paneOptions = session
  ? {session}
  : {customTokenFile: customToken};
const api = process.env.LAP_API_BASE || 'https://botracing-61.web.app';
// The app the panes open: the API's own host by default; --pane-origin
// http://localhost:<live slot port> checks a branch's app against the same API
// before it deploys (AGENTS.md live slots).
const paneOrigin = arg('--pane-origin', api);

const root = mkdtempSync(resolve(tmpdir(), 'live-e2e-'));
const dirs = Object.fromEntries(
  ['capture', 'telemetry', 'iracing', 'home', 'work'].map(d => {
    const p = resolve(root, d);
    mkdirSync(p, {recursive: true});
    return [d, p];
  }),
);
// The ID token the watcher uploads with and the polls read with.
const token = session
  ? (() => {
      const file = resolve(root, 'seat.idt');
      writeFileSync(file, session.idToken);
      return file;
    })()
  : resolve(arg('--token', ''));
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(7)} s`;

// The watcher, as the tray runs it, with LMU "running" (node.exe always is).
const watcher = spawn(
  nodeExe,
  [
    resolve(appDir, 'tools/uploader/watch.mjs'),
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
let paneOpening = null;
// The Sessions list, open and untouched from before the first lap: the drive
// must change it by itself (Botkin had to filter to LMU to find the live
// session, thread 1 #4997). Its text is the baseline; the first change after
// lap 1 reached the disk is the list showing the drive (new row, or the laps
// column of the row it lands on).
let listPane = null;
let listBaseline = null;
const onList = new Map();
if (!noScreen) {
  listPane = await openPane({origin: paneOrigin, ...paneOptions});
  await listPane.goto('/', 4000);
  listBaseline = await listPane.text();
  console.log(`${stamp()} list pane open (${listBaseline.length} chars)`);
}
// The capture's session was already stored: nothing can "arrive", so the run
// says so and stops, instead of reporting laps that never reached the app. The
// replay shifts the capture's clock to now (replayCapture.mjs), so this is a
// harness fault, not a product miss. Only before the first lap arrives: in a
// valid run the watcher logs the same line once the cloud analysis writes a
// newer stamp (sidepod, #608 review), and that must not wipe real verdicts.
let alreadyStored = false;
const poll = async () => {
  try {
    if (
      seen.size === 0 &&
      readFileSync(watchLog, 'utf8').includes(
        'nothing new over the stored session',
      )
    )
      alreadyStored = true;
  } catch {
    // No log yet.
  }
  if (!sessionId) {
    try {
      const m = readFileSync(watchLog, 'utf8').match(
        /live: ([0-9a-f]{16}) \d+ laps/,
      );
      if (m) sessionId = m[1];
    } catch {
      // No log yet.
    }
    // The pane opens beside the polls, not between them: awaiting its ~7 s
    // start here left the API unread, and lap 1 read 13 s "in the app" for a
    // doc written 5.6 s after the line (pit wall thread 69).
    if (sessionId && !noScreen)
      paneOpening = openPane({origin: paneOrigin, ...paneOptions})
        .then(async p => {
          await p.goto(`/session/${sessionId}`);
          pane = p;
          console.log(`${stamp()} pane open on session ${sessionId}`);
        })
        // No pane: no lap reaches the screen, and the verdict says so.
        .catch(err => console.log(`${stamp()} pane: ${err.message}`));
    if (!sessionId) return;
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
  if (listPane && !onList.has(1) && lapAt.length > 0) {
    if ((await listPane.text()) !== listBaseline) {
      onList.set(1, Date.now() - lapAt[0]);
      console.log(
        `${stamp()} list changed ${(onList.get(1) / 1000).toFixed(
          1,
        )} s after lap 1 reached the disk`,
      );
    }
  }
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

const done = () =>
  seen.size >= laps && (noScreen || (onScreen.size >= laps && onList.has(1)));
const until = Date.now() + (laps * 100_000) / Number(speed) + 180_000;
while (Date.now() < until && !done() && !alreadyStored) {
  await new Promise(r => setTimeout(r, 2000));
  await poll().catch(err => console.log(`${stamp()} poll: ${err.message}`));
}
await paneOpening;
if (pane) await pane.close();
if (listPane) await listPane.close();
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
    liveVerdict({
      laps: 1,
      latencyMs: onList,
      maxLapS: maxListS,
      where: 'the Sessions list (open, untouched)',
    }),
  );
}
// The recording itself reached Storage through the signed-URL PUT, the one
// step the emulator gate cannot run (pit wall #5133). uploadLive writes the lap
// docs only after every part is up, so a lap in the app already implies it;
// this says it outright, and fails a run where no part was ever sent (every
// part skipped by md5 would measure nothing).
let partsSent = 0;
try {
  for (const m of readFileSync(watchLog, 'utf8').matchAll(
    /live: (\d+) of \d+ parts sent/g,
  ))
    partsSent += Number(m[1]);
} catch {
  // No log: the lap verdicts already fail.
}
console.log(`recording parts sent to Storage: ${partsSent}`);
if (partsSent === 0 && !alreadyStored)
  verdicts.push({
    problems: ['no recording part was sent to Storage (signed-URL PUT)'],
  });
const problems = alreadyStored
  ? [
      'capture already uploaded ("nothing new over the stored session"): this run measured nothing, use another capture',
    ]
  : verdicts.flatMap(v => v.problems);
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
