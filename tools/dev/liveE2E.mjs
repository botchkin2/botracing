// Live laps end to end without a driver (pit-wall thread 66): a real capture
// replayed lap by lap (replayCapture.mjs), the uploader's own watcher running
// as seat-test against the production API with LMU "running", and the time
// from each lap reaching the disk to the session's lap count showing it.
//
//   node tools/dev/liveE2E.mjs --from <capture folder> --token <seat-test ID token file> [--laps 4] [--speed 1]
//
// Scratch folders only: nothing of the real tray, capture or uploader is touched.
import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const from = resolve(arg('--from', ''));
const token = resolve(arg('--token', ''));
const laps = Number(arg('--laps', '4'));
const speed = arg('--speed', '1');
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
  [resolve(here, '../uploader/watch.mjs'), '--', '--remote', '--work', dirs.work],
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
  [resolve(here, 'replayCapture.mjs'), '--from', from, '--out', dirs.capture, '--speed', speed, '--laps', String(laps)],
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
const poll = async () => {
  if (!sessionId) {
    try {
      const m = readFileSync(watchLog, 'utf8').match(/live: ([0-9a-f]{16}) \d+ laps/);
      if (m) sessionId = m[1];
    } catch {
      // No log yet.
    }
    return;
  }
  const res = await fetch(`${api}/api/lmu/sessions/${sessionId}`, {
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
    console.log(`${stamp()} lap ${k} in the app ${(seen.get(k) / 1000).toFixed(1)} s after the line (lapCount ${n}, best ${body.bestLapTime})`);
  }
};

const until = Date.now() + (laps * 100_000) / Number(speed) + 180_000;
while (Date.now() < until && seen.size < laps) {
  await new Promise(r => setTimeout(r, 2000));
  await poll().catch(() => {});
}
watcher.kill();
replay.kill();
const ms = [...seen.values()].sort((a, b) => a - b);
console.log(
  `session ${sessionId}; laps in the app ${seen.size}/${laps}; latency s: ${ms.map(v => (v / 1000).toFixed(1)).join(' ')}`,
);
console.log(`scratch: ${root} (watch.log in home/)`);
process.exit(seen.size === laps ? 0 : 1);
