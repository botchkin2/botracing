// Live laps without a driver (pit-wall thread 66): plays a real LMU capture
// back into a scratch capture root the way the tray's recorder writes one
// with the per-lap cut: a chunk ends at each player line crossing, whole files
// only (.tmp then rename), meta.json kept current, and status.json's lastLapAt
// set once the lap's chunk is on disk. Point an rc tray's LAP_CAPTURE at --out.
//
//   node tools/dev/replayCapture.mjs --from <capture folder> --out <root> [--speed 1]
//
// --speed 10 plays ten times faster. The play-time clock is the capture's own.
// The wall clock is shifted to now (every wall_ms, meta's startUtc/endUtc and
// the folder's name): the session id comes from the capture's wall time, so a
// capture replayed twice would land on the same stored session and every lap
// would be "nothing new". A replay is a drive happening now. --keep-clock keeps
// the capture's own time (a test of the same stored session).
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import {basename, resolve} from 'node:path';
import {rows, run, sqlPath} from '../sessions/duck.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const from = resolve(arg('--from', ''));
const root = resolve(arg('--out', ''));
const speed = Number(arg('--speed', '1'));
// --laps n: stop after the nth finished lap (the drive goes on, the test ends).
const maxLaps = Number(arg('--laps', '0')) || Infinity;
let lapsDone = 0;
const keepClock = process.argv.includes('--keep-clock');
if (!existsSync(resolve(from, 'meta.json')) || !arg('--out')) {
  console.error(
    'usage: --from <capture folder> --out <scratch root> [--speed n]',
  );
  process.exit(2);
}

const glob = kind => sqlPath(resolve(from, `${kind}-*.parquet`));
// The player's finished laps, as the recorder sees them: mLapNumber steps,
// at the new lap's mLapStartET. Not every mLapStartET step: a race start sets
// it while the lap number stays (lap 0 begins), which is no finished lap.
const crossings = rows(
  ':memory:',
  `SELECT ls t FROM (SELECT mLapStartET ls, mLapNumber lap,
     lag(mLapNumber) OVER (ORDER BY mElapsedTime) pl FROM read_parquet(${glob(
       'player',
     )}))
   WHERE pl IS NOT NULL AND lap <> pl ORDER BY t`,
).map(r => Number(r.t));
const [{t0, t1}] = rows(
  ':memory:',
  `SELECT min(mElapsedTime) t0, max(mElapsedTime) t1 FROM read_parquet(${glob(
    'player',
  )})`,
);
// The recorder cuts a lap's chunk 1 s after the crossing (recorder.rs
// LAP_CUT_AFTER_S): the chunk then holds what marks the lap finished.
const LAP_CUT_AFTER_S = 1.0;
const lapCuts = crossings
  .filter(t => t > Number(t0))
  .map(t => t + LAP_CUT_AFTER_S);
const cuts = [Number(t0), ...lapCuts, Number(t1) + 0.001];

const meta0 = JSON.parse(readFileSync(resolve(from, 'meta.json'), 'utf8'));
// The shift: the capture's first player sample lands on now.
const [{w0}] = rows(
  ':memory:',
  `SELECT min(wall_ms) w0 FROM read_parquet(${glob('player')})`,
);
const shiftMs = keepClock ? 0 : Date.now() - Number(w0);
const shifted = iso =>
  iso ? new Date(Date.parse(iso) + shiftMs).toISOString() : iso;
const meta = {
  ...meta0,
  startUtc: shifted(meta0.startUtc),
  endUtc: shifted(meta0.endUtc),
};
// The folder is named by its start: <startUtc with : as ->_<track>_<session>.
const stampOf = iso => iso.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
const folder = keepClock
  ? basename(from)
  : basename(from).replace(/^[^_]+/, stampOf(meta.startUtc));
const dir = resolve(root, folder);
mkdirSync(dir, {recursive: true});
const status = resolve(root, 'status.json');
const writeJson = (path, value) => {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 1));
  renameSync(`${path}.tmp`, path);
};
const iso = () => new Date().toISOString();
// status.json as the recorder writes it (recorder.rs Status::json), every
// field: the watcher sends it on in its heartbeat, and the contract replay
// checks its shape against the real ones (contract/README.md).
const recorderStatus = (state, fields) => ({
  captureBytes: 0,
  droppedPct: 0,
  gameVersion: meta.gameVersion ?? null,
  lastChunkAt: null,
  lastLapAt,
  layoutOk: true,
  layoutReason: '',
  pid: process.pid,
  sessionDir: null,
  state,
  updatedAt: iso(),
  ...fields,
});

writeJson(resolve(dir, 'meta.json'), {...meta, endUtc: null, chunks: 0});
let lastLapAt = null;
const started = Date.now();
for (let n = 0; n + 1 < cuts.length; n++) {
  const [a, b] = [cuts[n], cuts[n + 1]];
  // Real time: wait until this chunk's end on the capture's clock.
  const due = started + ((b - cuts[0]) * 1000) / speed;
  const wait = due - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  const name = String(n).padStart(4, '0');
  for (const [kind, clock] of [
    ['player', 'mElapsedTime'],
    ['field', 'et'],
    ['session', 'mCurrentET'],
  ]) {
    const out = resolve(dir, `${kind}-${name}.parquet`);
    run(
      ':memory:',
      `COPY (SELECT * REPLACE (wall_ms + ${shiftMs} AS wall_ms) FROM read_parquet(${glob(
        kind,
      )}) WHERE ${clock} >= ${a} AND ${clock} < ${b})
       TO ${sqlPath(`${out}.tmp`)} (FORMAT parquet, COMPRESSION zstd)`,
    );
    renameSync(`${out}.tmp`, out);
  }
  writeJson(resolve(dir, 'meta.json'), {...meta, endUtc: null, chunks: n + 1});
  // A chunk that ends at a crossing is a finished lap on disk.
  if (lapCuts.includes(b)) {
    lastLapAt = iso();
    lapsDone++;
  }
  writeJson(
    status,
    recorderStatus('recording', {
      lastChunkAt: iso(),
      sessionDir: folder,
    }),
  );
  console.log(
    `${iso()} chunk ${name} [${a.toFixed(2)}, ${b.toFixed(2)})${
      lapCuts.includes(b) ? ' lap on disk' : ''
    }`,
  );
  if (lapsDone >= maxLaps) break;
}
writeJson(resolve(dir, 'meta.json'), {...meta, chunks: cuts.length - 1});
writeJson(status, recorderStatus('waiting'));
console.log(`${iso()} replay done, ${lapsDone} laps`);
