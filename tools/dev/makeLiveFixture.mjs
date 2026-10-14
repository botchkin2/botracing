// The live gate's capture for CI ("Release tray", roadmap 2w): the first laps
// of a real LMU capture, cut on the player's own clock through the crossing
// that ends lap `--laps` (plus 5 s for the chunk cut after it). Every table is
// kept as recorded (player, session, field: the replay reads all three), so the
// replay and the analysis run as they do on the PC. Writes a folder; uploading
// it to the golden bucket is a separate step for whoever may write there
// (tools/golden/README.md).
//
//   node tools/dev/makeLiveFixture.mjs --from <capture folder> --out <folder> [--laps 3]
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {rows, run, sqlPath} from '../sessions/duck.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const from = resolve(arg('--from', ''));
const out = resolve(arg('--out', ''));
const laps = Number(arg('--laps', '3'));
const glob = kind => sqlPath(resolve(from, `${kind}-*.parquet`));
mkdirSync(out, {recursive: true});

// The player's lap crossings (mLapNumber steps), as the replay finds them.
const crossings = rows(
  ':memory:',
  `SELECT t FROM (SELECT mElapsedTime t, mLapNumber n, lag(mLapNumber) OVER (ORDER BY mElapsedTime) pn
     FROM read_parquet(${glob('player')})) WHERE n > pn ORDER BY t`,
).map(r => Number(r.t));
if (crossings.length < laps + 1)
  throw new Error(`the capture has ${crossings.length} crossings; ${laps} laps need ${laps + 1}`);
const end = crossings[laps] + 5;

for (const [kind, clock] of [
  ['player', 'mElapsedTime'],
  ['session', 'mCurrentET'],
  ['field', 'et'],
]) {
  run(
    ':memory:',
    `COPY (SELECT * FROM read_parquet(${glob(kind)}) WHERE ${clock} < ${end} ORDER BY ${clock})
     TO ${sqlPath(resolve(out, `${kind}-0000.parquet`))} (FORMAT parquet, COMPRESSION zstd)`,
  );
}

const meta = JSON.parse(readFileSync(resolve(from, 'meta.json'), 'utf8'));
meta.chunks = 1;
writeFileSync(resolve(out, 'meta.json'), `${JSON.stringify(meta, null, 1)}\n`);
console.log(
  `wrote ${readdirSync(out).length} files to ${out}: laps 1..${laps} (through ${end.toFixed(1)} s)`,
);
