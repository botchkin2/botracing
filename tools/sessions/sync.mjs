// Find new recordings, group them into sessions, archive, analyze, upload.
//
//   node tools/sessions/sync.mjs                      upload what changed
//   node tools/sessions/sync.mjs --local              write everything to the work
//                                                     folder, upload nothing
//   node tools/sessions/sync.mjs --since 2026-09-20   only sessions from that day on
//   node tools/sessions/sync.mjs --only "Road Atlanta" only matching file names
//   node tools/sessions/sync.mjs --list               show the session grouping and stop
//   node tools/sessions/sync.mjs --force              redo sessions already uploaded
//
// A file changed in the last few minutes is skipped: the game may still be
// writing it. Running again later picks it up. Safe to run as often as you like.
import {createHash} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import * as lmu from './lmu.mjs';
import {analysisVersion, analyzeSession, loadRecording} from './analyze.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const flag = name => process.argv.includes(name);

const adapter = lmu;
const folder = arg(
  '--folder',
  process.env.LMU_TELEMETRY || adapter.defaultFolder,
);
const ownerId = arg('--owner', process.env.LAP_OWNER || 'botkin');
const since = arg('--since', '');
const only = arg('--only', '');
const local = flag('--local');
const force = flag('--force');
const quietMin = Number(arg('--quiet-min', '3'));
const work = resolve(
  arg('--work', resolve(process.env.LOCALAPPDATA || homedir(), 'lap-sessions')),
);
const statePath = resolve(work, 'state.json');

// Recordings of one session that are further apart than this start a new one.
const SESSION_GAP_H = 6;
const RESTART_MAX_SEC = 5 * 60;
const RESTART_GAP_SEC = 2 * 60;
// Shorter recordings hold no lap: a menu, a reset, a false start. Skip them.
const MIN_RECORDING_SEC = 30;

function hash(...parts) {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function readState() {
  if (!existsSync(statePath)) return {files: {}, sessions: {}};
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

function saveState(state) {
  mkdirSync(work, {recursive: true});
  writeFileSync(statePath, JSON.stringify(state));
}

function log(line) {
  console.log(line);
}

// Describe every recording, reusing earlier results for files that have not changed.
function scan(state) {
  if (!existsSync(folder)) throw new Error(`No telemetry folder at ${folder}`);
  const out = [];
  let skippedQuiet = 0;
  for (const name of readdirSync(folder)) {
    const path = resolve(folder, name);
    if (!adapter.isRecording(path)) continue;
    if (only && !name.includes(only)) continue;
    const stat = statSync(path);
    if (Date.now() - stat.mtimeMs < quietMin * 60 * 1000) {
      skippedQuiet++;
      continue;
    }
    const known = state.files[name];
    let info =
      known && known.size === stat.size && known.mtimeMs === stat.mtimeMs
        ? known.info
        : null;
    if (!info) {
      try {
        info = adapter.describe(path);
      } catch (error) {
        log(`skip ${name}: ${String(error.message).split('\n')[0]}`);
        continue;
      }
      state.files[name] = {size: stat.size, mtimeMs: stat.mtimeMs, info};
    }
    if (!info.recordedAt || info.endT - info.startT < MIN_RECORDING_SEC) {
      continue;
    }
    if (since && info.recordedAt.slice(0, 10) < since) continue;
    out.push({path, size: stat.size, info});
  }
  if (skippedQuiet)
    log(`${skippedQuiet} file(s) still being written, skipped for now`);
  return out;
}

// A session is recordings with the same owner, sim, track layout, car, and
// session type that belong to one run of the game's session. A later file
// belongs to the same session when the game's session timer advanced with the
// wall clock since the previous file (practice runs back to the pits), or when
// it restarted with the same session clock (a race restart).
function sameSession(prev, next) {
  const wall =
    (Date.parse(next.recordedAt) - Date.parse(prev.recordedAt)) / 1000;
  if (wall > SESSION_GAP_H * 3600) return false;
  if (Math.abs(next.startT - prev.startT - wall) < 90) return true;
  // Same start clock only means a restart when the previous file was a short
  // false start, or the next one began right after it. The default race clock
  // repeats, so two real races would otherwise merge.
  if (next.sessionClock !== prev.sessionClock) return false;
  const prevSec = prev.endT - prev.startT;
  return prevSec < RESTART_MAX_SEC || wall < prevSec + RESTART_GAP_SEC;
}

function group(files) {
  const byKey = new Map();
  for (const file of files.sort((a, b) =>
    a.info.recordedAt.localeCompare(b.info.recordedAt),
  )) {
    const {info} = file;
    const key = [
      ownerId,
      info.sim,
      info.layout,
      info.car,
      info.sessionType,
    ].join('|');
    const list = byKey.get(key) || [];
    const last = list[list.length - 1];
    if (last && sameSession(last.files[last.files.length - 1].info, info)) {
      last.files.push(file);
    } else {
      list.push({key, files: [file]});
    }
    byKey.set(key, list);
  }
  const sessions = [];
  for (const list of byKey.values()) {
    for (const s of list) {
      const first = s.files[0].info;
      s.id = hash(s.key, first.recordedAt);
      s.fingerprint = hash(
        analysisVersion,
        ...s.files.map(f => `${f.info.source}:${f.size}`),
      );
      for (const f of s.files) {
        f.id = hash(ownerId, first.sim, f.info.source, f.info.recordedAt);
      }
      sessions.push(s);
    }
  }
  return sessions.sort((a, b) =>
    a.files[0].info.recordedAt.localeCompare(b.files[0].info.recordedAt),
  );
}

function slugId(sim, name) {
  return `${sim}-${lmu.slug(name)}`;
}

function build(s) {
  const dir = resolve(work, 'archive', s.id);
  mkdirSync(dir, {recursive: true});
  const first = s.files[0].info;
  const sim = first.sim;
  const files = [];
  const recs = [];
  const recordings = [];
  for (const f of s.files) {
    const samples = resolve(dir, `${f.id}.samples.parquet`);
    const events = resolve(dir, `${f.id}.events.parquet`);
    adapter.writeArchive(f.path, f.info, samples, events);
    const prefix = `archive/${sim}/${s.id}/${f.id}`;
    files.push({local: samples, dest: `${prefix}/samples.parquet`});
    files.push({local: events, dest: `${prefix}/events.parquet`});
    recs.push(loadRecording(f.info, samples, events));
    const {_channels, _events, ...info} = f.info;
    recordings.push({
      ...info,
      id: f.id,
      ownerId,
      sessionId: s.id,
      durationSec: Math.round((info.endT - info.startT) * 1000) / 1000,
      archive: {
        samples: `${prefix}/samples.parquet`,
        events: `${prefix}/events.parquet`,
        bytes: statSync(samples).size + statSync(events).size,
      },
    });
  }

  const a = analyzeSession(recs);
  const track = {name: first.track, variant: first.layout};
  const trackId = slugId(sim, first.layout);
  const car = {name: first.car, class: first.carClass};
  const carId = slugId(sim, first.car);
  const lapId = lap =>
    `${s.files[lap.rec].id}-${String(lap.index).padStart(3, '0')}`;

  const traces = [];
  const laps = a.laps.map(lap => {
    const rec = s.files[lap.rec].info;
    const id = lapId(lap);
    const tracePath = `traces/${ownerId}/${id}/v1.csv.gz`;
    traces.push({dest: tracePath, csv: () => a.trace(lap)});
    const startTime = new Date(
      Date.parse(rec.recordedAt) + (lap.startT - rec.startT) * 1000,
    ).toISOString();
    return plain({
      id,
      ownerId,
      sim,
      sessionId: s.id,
      recordingId: s.files[lap.rec].id,
      trackId,
      track,
      carId,
      car,
      sessionType: first.sessionType,
      startTime,
      lapNumber: lap.lapNumber,
      lapTime: lap.lapTime,
      gameLapTime: lap.gameLapTime,
      durationSec: lap.durationSec,
      timed: lap.timed,
      partial: lap.partial,
      incomplete: lap.partial || !lap.timed,
      pitlane: lap.pitlane,
      pitIn: lap.pitIn,
      pitOut: lap.pitOut,
      offtrack: lap.offtrack,
      offTrackSec: lap.offTrackSec,
      pastEdgeSec: lap.pastEdgeSec,
      impactMax: lap.impactMax,
      sectors: lap.sectors,
      stint: lap.stint,
      comparable: lap.comparable,
      clean: lap.clean,
      reasons: lap.reasons,
      distanceM: lap.distanceM,
      corners: lap.corners || [],
      trace: {path: tracePath, rows: lap.i1 - lap.i0 + 1},
      analysisVersion,
    });
  });

  const last = s.files[s.files.length - 1].info;
  const session = plain({
    id: s.id,
    ownerId,
    sim,
    trackId,
    track,
    carId,
    car,
    sessionType: first.sessionType,
    sessionClock: first.sessionClock,
    weather: first.weather,
    startedAt: first.recordedAt,
    endedAt: new Date(
      Date.parse(last.recordedAt) + (last.endT - last.startT) * 1000,
    ).toISOString(),
    recordingIds: s.files.map(f => f.id),
    ...a.summary,
    bestLapId: a.best ? lapId(a.best) : null,
    corners: a.cornerStats,
    band: a.band
      ? {
          path: `bands/${ownerId}/${s.id}/v1.json.gz`,
          stepM: a.band.stepM,
          lengthM: a.band.lengthM,
          laps: a.band.laps,
        }
      : null,
    lapTable: laps.map(lap => ({
      id: lap.id,
      lapNumber: lap.lapNumber,
      lapTime: lap.lapTime,
      stint: lap.stint,
      comparable: lap.comparable,
      reasons: lap.reasons,
      offTrackSec: lap.offTrackSec,
    })),
    analysisVersion,
    updatedAt: new Date().toISOString(),
  });

  return {session, recordings, laps, band: a.band, traces, files};
}

function writeLocal(out) {
  const dir = resolve(work, 'out', out.session.id);
  mkdirSync(resolve(dir, 'traces'), {recursive: true});
  writeFileSync(
    resolve(dir, 'session.json'),
    JSON.stringify(out.session, null, 2),
  );
  writeFileSync(
    resolve(dir, 'recordings.json'),
    JSON.stringify(out.recordings, null, 2),
  );
  writeFileSync(resolve(dir, 'laps.json'), JSON.stringify(out.laps, null, 2));
  if (out.band)
    writeFileSync(resolve(dir, 'band.json'), JSON.stringify(out.band));
  for (const job of out.traces) {
    const id = job.dest.split('/')[2];
    writeFileSync(resolve(dir, 'traces', `${id}.csv`), job.csv());
  }
  return dir;
}

function describeSession(s) {
  const info = s.files[0].info;
  return `${info.recordedAt.slice(0, 16)} ${info.sessionType.padEnd(10)} ${
    info.track
  } | ${info.car} | ${s.files.length} file(s)`;
}

async function main() {
  const state = readState();
  const files = scan(state);
  saveState(state);
  const sessions = group(files);
  log(`${files.length} recordings in ${sessions.length} sessions (${folder})`);

  if (flag('--list')) {
    for (const s of sessions) log(`${s.id} ${describeSession(s)}`);
    return;
  }

  let store = null;
  if (!local) store = await import('./store.mjs');

  let done = 0;
  let failed = 0;
  // Newest first: recent sessions matter most, and a long backfill fills in
  // the past last.
  for (const s of [...sessions].reverse()) {
    if (!force && !local && state.sessions[s.id] === s.fingerprint) continue;
    log(`${s.id} ${describeSession(s)}`);
    try {
      const out = build(s);
      log(
        `  ${out.laps.length} laps, ${
          out.session.comparableCount
        } comparable, best ${out.session.bestLapTime ?? '-'}`,
      );
      if (local) {
        log(`  -> ${writeLocal(out)}`);
      } else {
        await store.upload(out, {log});
        state.sessions[s.id] = s.fingerprint;
        saveState(state);
      }
      done++;
    } catch (error) {
      failed++;
      log(
        `  failed: ${String(error.stack || error)
          .split('\n')
          .slice(0, 3)
          .join(' | ')}`,
      );
    }
  }
  log(
    `done ${done}, failed ${failed}, unchanged ${
      sessions.length - done - failed
    }`,
  );
  if (failed) process.exitCode = 1;
}

await main();
