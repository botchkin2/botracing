// Makes a golden slice from a real session on this PC (the curator's loader
// finds it, the sim's adapter writes its neutral archive):
//
//   node tools/golden/make.mjs <name>            makes .golden/<name>/ and expected/<name>.json
//   node tools/golden/make.mjs <name> --upload   and copies the slice to the private bucket
//
// A slice is the archive cut to the manifest's laps and to the channels the
// analysis reads (`wanted`), plus the track map the full session was analysed
// against, so corner numbers do not depend on the slice having enough laps to
// make its own. It carries no driver name, no ids and no file paths. The
// manifest's `fixtures` holds each file's sha256; CI fetches nothing else.
import {createHash} from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {findSessions} from '../curate/loader.mjs';
import {analyzeSession, eventKinds, loadRecording, wanted} from '../sessions/analyze.mjs';
import {run, sqlPath} from '../sessions/duck.mjs';
import {adapter, telemetryFolder} from '../sessions/sims.mjs';
import {analyzeGolden, summaryOf} from './golden.mjs';
import {putFixtures} from './fetch.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, 'manifest.json');

// Events that hold a state until the next one: a slice starting mid-state
// needs the state at its first sample.
const STATE_KINDS = [
  'in_pits',
  'gear',
  'surface',
  'yellow_flag',
  'current_sector',
  'sector1_flag',
  'sector2_flag',
  'sector3_flag',
  'tyres_compound',
  'minimum_path_wetness',
];
const list = names => names.map(n => `'${n}'`).join(',');

/** The columns of the samples that the analysis reads, `tick` first. */
function columnsOf(info) {
  const present = new Set(info.channels.flatMap(c => c.columns));
  return ['tick', ...wanted.filter(n => n === 't' || present.has(n))];
}

/** Cuts one recording's archive to [t0, t1] seconds on its own clock. */
function slice({samples, events, info, t0, t1, to}) {
  const cols = columnsOf(info);
  const pq = "(FORMAT PARQUET, COMPRESSION ZSTD, COMPRESSION_LEVEL 19)";
  run(
    ':memory:',
    `COPY (SELECT ${cols.join(', ')} FROM read_parquet(${sqlPath(samples)}) ` +
      `WHERE t >= ${t0} AND t <= ${t1} ORDER BY tick) TO ${sqlPath(to.samples)} ${pq}`,
    {readonly: false},
  );
  run(
    ':memory:',
    `COPY (SELECT t, name, v1, v2, v3, v4 FROM (` +
      `SELECT t, name, v1, v2, v3, v4 FROM read_parquet(${sqlPath(events)}) ` +
      `WHERE name IN (${list(eventKinds)}) AND t >= ${t0} AND t <= ${t1} ` +
      `UNION ALL ` +
      `SELECT ${t0} AS t, name, v1, v2, v3, v4 FROM (` +
      `SELECT *, row_number() OVER (PARTITION BY name ORDER BY t DESC) AS rn ` +
      `FROM read_parquet(${sqlPath(events)}) ` +
      `WHERE name IN (${list(STATE_KINDS)}) AND t < ${t0}) WHERE rn = 1) ORDER BY t) ` +
      `TO ${sqlPath(to.events)} ${pq}`,
    {readonly: false},
  );
}

/** The recording's info without what identifies a person or a file. */
function cleanInfo(info, t0, t1) {
  const {source, driver, sessionClock, groupId, ...rest} = info;
  void source; void driver; void sessionClock; void groupId;
  return {...rest, startT: t0, endT: t1, fuelSetup: info.fuelSetup ?? null};
}

const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

export async function makeSlice(name, {upload = false} = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const entry = manifest.sessions[name];
  if (!entry) throw new Error(`"${name}" is not in tools/golden/manifest.json`);
  const sim = adapter(entry.sim);
  const found = findSessions({
    adapter: sim,
    folder: telemetryFolder(entry.sim),
    ownerId: 'golden',
    log: () => {},
  }).find(s => s.files[0].info.recordedAt === entry.recordedAt);
  if (!found) throw new Error(`no ${entry.sim} session starting ${entry.recordedAt} on this PC`);

  // The full session once: its laps say where the slice is cut, and its track
  // map is what the slice is analysed against.
  const work = resolve(here, '.work', name);
  rmSync(work, {recursive: true, force: true});
  mkdirSync(work, {recursive: true});
  const archives = found.files.map((f, i) => {
    const samples = resolve(work, `full-${i}.samples.parquet`);
    const events = resolve(work, `full-${i}.events.parquet`);
    sim.writeArchive(f.path, f.info, samples, events);
    return {samples, events, info: f.info};
  });
  const recs = archives.map(a => loadRecording(a.info, a.samples, a.events));
  const full = analyzeSession(recs, {
    sessionId: name,
    sessionType: entry.sessionType,
    splitFiles: entry.sim === 'iracing',
  });
  const [from, to] = entry.laps;
  const chosen = full.laps.filter((_, i) => i + 1 >= from && i + 1 <= to);
  if (chosen.length === 0) throw new Error(`${name}: laps ${from}-${to} are outside the session's ${full.laps.length}`);

  const out = resolve(here, '.golden', name);
  rmSync(out, {recursive: true, force: true});
  mkdirSync(out, {recursive: true});
  let files = 0;
  archives.forEach((a, r) => {
    const mine = chosen.filter(l => l.rec === r);
    if (mine.length === 0) return;
    const t0 = recs[r].s.t[Math.min(...mine.map(l => l.i0))];
    const t1 = recs[r].s.t[Math.max(...mine.map(l => l.i1))];
    const dest = {
      samples: resolve(out, `${files}.samples.parquet`),
      events: resolve(out, `${files}.events.parquet`),
    };
    slice({samples: a.samples, events: a.events, info: a.info, t0, t1, to: dest});
    writeFileSync(resolve(out, `${files}.info.json`), JSON.stringify(cleanInfo(a.info, t0, t1)));
    files++;
  });
  writeFileSync(
    resolve(out, 'golden.json'),
    JSON.stringify({
      name,
      sim: entry.sim,
      sessionType: entry.sessionType,
      files,
      trackMap: full.trackMap ?? null,
      boundaries: full.boundaries?.state ?? null,
    }),
  );
  rmSync(work, {recursive: true, force: true});

  // The expected numbers: the slice through the analysis, as CI will run it.
  const expected = summaryOf(analyzeGolden(out));
  writeFileSync(
    resolve(here, 'expected', `${name}.json`),
    `${JSON.stringify(expected, null, 1)}\n`,
  );
  manifest.fixtures[name] = Object.fromEntries(
    readdirSync(out)
      .sort()
      .map(f => [f, {sha256: sha256(resolve(out, f)), bytes: readFileSync(resolve(out, f)).length}]),
  );
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (upload) putFixtures(name, out, manifest.bucket);
  const bytes = Object.values(manifest.fixtures[name]).reduce((n, f) => n + f.bytes, 0);
  console.log(`${name}: ${chosen.length} laps in ${files} file(s), ${(bytes / 1e6).toFixed(2)} MB, ${expected.laps.length} lap rows`);
  void copyFileSync;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [name, ...flags] = process.argv.slice(2);
  if (!name) {
    console.error('usage: node tools/golden/make.mjs <name> [--upload]');
    process.exit(2);
  }
  makeSlice(name, {upload: flags.includes('--upload')}).catch(e => {
    console.error(`STOP: ${e.message}`);
    process.exit(1);
  });
}
