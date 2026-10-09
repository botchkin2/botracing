// Find new recordings, group them into sessions, archive, analyze, upload.
//
//   node tools/sessions/sync.mjs --owner <uid>        upload what changed.
//                                                     Required unless --remote
//                                                     (the token's owner) or
//                                                     LAP_OWNER is set.
//   node tools/sessions/sync.mjs --local              write everything to the work
//                                                     folder, upload nothing
//   node tools/sessions/sync.mjs --since 2026-09-20   only sessions from that day on
//   node tools/sessions/sync.mjs --only "Road Atlanta" only matching file names
//   node tools/sessions/sync.mjs --list               show the session grouping and stop
//   node tools/sessions/sync.mjs --check              every step before the first write, over all
//                                                     sessions: fingerprints, staleness, fold plan.
//                                                     Analyses and writes nothing; exits 1 on a throw
//   node tools/sessions/sync.mjs --force              redo sessions already uploaded
//   node tools/sessions/sync.mjs --rebuild-track <id> replace a track's corner map (--local only; curated
//                                                     maps change with tools/curate/curate.mjs)
//   node tools/sessions/sync.mjs --jobs 4             sessions analyzed at once
//   node tools/sessions/sync.mjs --events-only --since 2026-09-14
//                                                     only set which online event
//                                                     uploaded sessions were; no analysis
//   node tools/sessions/sync.mjs --sim iracing        iRacing .ibt (default lmu)
//   node tools/sessions/sync.mjs --log-folder <dir>   the sim's logs, if not the default
//   node tools/sessions/sync.mjs --capture <dir>      tools/capture's output, if not
//                                                     %LOCALAPPDATA%\lap-capture
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
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {availableParallelism, homedir} from 'node:os';
import {Worker, isMainThread, parentPort} from 'node:worker_threads';
import {resolve} from 'node:path';
import * as lmu from './lmu.mjs';
import * as iracing from './iracing.mjs';
import {groupFiles, hash, scanFolder} from './sessionFiles.mjs';
import {versionKey} from './versionKey.mjs';
import {
  analysisVersion,
  blockVersions,
  analyzeSession,
  loadRecording,
  trackMapVersion,
} from './analyze.mjs';
import {
  buildCornerSlices,
  GRID_STEP_M,
  SLICE_AFTER_M,
  SLICE_BEFORE_M,
  SLICE_FORMAT,
} from './cornerSlices.mjs';
import {classLapsDoc} from '../../src/analysis/classLaps.ts';
import {finishDoc} from '../../src/analysis/raceResult.ts';
import {fieldFor} from './field.mjs';
import {damageFor} from './playerDamage.mjs';
import {checkDoc} from './docShape.mjs';
import {packState, staleRev, unpackState} from './layoutBoundaries.mjs';
import {
  forgetOtherOwners,
  freshState,
  liftWindow,
  markDone,
  OLDER_REQUEST,
} from './syncState.mjs';
import {windowsOf} from '../../src/analysis/cornerBoundaries.ts';
import {lapTraffic} from './lapTraffic.mjs';
import {foldsSurface, openRemoteStore} from './remoteStore.mjs';
import {
  DEFAULT_RESYNC_CAP,
  catalogStamp,
  staleByCatalog,
} from './catalogStamp.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const flag = name => process.argv.includes(name);

const sims = {lmu, iracing};
const simName = arg('--sim', process.env.LAP_SIM || 'lmu');
const adapter = sims[simName];
if (!adapter) throw new Error(`unknown sim "${simName}"`);
const folder = arg(
  '--folder',
  process.env.LMU_TELEMETRY || adapter.defaultFolder,
);
// --remote: no Admin credentials. The store is the upload function (storeClient.mjs),
// signed in by the Firebase ID token in the file LAP_TOKEN_FILE (the tray app
// keeps it fresh), and the owner is whatever key the server holds for that user.
const remote = !flag('--local') && (flag('--remote') || !!process.env.LAP_API);
// Track data (corner maps, boundaries, surface) is curated by Botkin, not made
// by users' syncs (pit wall thread 2 #155, #210): a sync that uploads, remote or
// with Admin credentials, reads the catalog and never builds, folds, rebuilds or
// uploads any of it. A map comes from `tools/curate/curate.mjs plan-add`. Only
// `--local` (nothing leaves the machine) still builds maps, for trying things.
const catalogOnly = !flag('--local');
if (catalogOnly && arg('--rebuild-track', '')) {
  console.error(
    '--rebuild-track is not available except with --local: track maps are curated. Use tools/curate/curate.mjs plan-replace.',
  );
  process.exit(2);
}
const remoteStore = remote ? await openRemoteStore() : null;
const ownerId = remote
  ? (await remoteStore.me()).ownerKey
  : arg('--owner', process.env.LAP_OWNER || '');
if (!remote && !ownerId) {
  console.error(
    'An owner is required: pass --owner <uid> or set LAP_OWNER. A remote sync takes the owner from the signed-in token.',
  );
  process.exit(2);
}
// `since` also takes the state's first-run window once the state is read
// (main), unless --since says otherwise.
let since = arg('--since', '');
// A fresh state limits its first run to this many days back (the tray: 14).
const firstWindowDays = Number(arg('--first-window-days', '0'));
// A remote sync analyses again at most this many sessions per run because the
// curated track catalog changed (newest first), so one edit does not send every
// session of a busy track through the upload at once.
const resyncCap = Number(arg('--catalog-resync-cap', DEFAULT_RESYNC_CAP));
const only = arg('--only', '');
// Session ids to leave alone this pass: the watcher's failed sessions still
// waiting on their backoff.
const skipIds = new Set(arg('--skip', '').split(',').filter(Boolean));
const local = flag('--local');
const check = flag('--check');
const force = flag('--force');
const quietMin = Number(arg('--quiet-min', '3'));
// Replace this track's stored corner map with one built from the next
// session analyzed there. Corner numbers change for every session after it.
const rebuildTrack = arg('--rebuild-track', '');
const work = resolve(
  arg('--work', resolve(process.env.LOCALAPPDATA || homedir(), 'lap-sessions')),
);
const statePath = resolve(work, 'state.json');
const olderRequestPath = resolve(work, OLDER_REQUEST);
const logFolder = arg('--log-folder', process.env.LMU_LOG || undefined);
const captureRoot = resolve(
  arg(
    '--capture',
    process.env.LAP_CAPTURE ||
      resolve(process.env.LOCALAPPDATA || homedir(), 'lap-capture'),
  ),
);
// Sessions analyzed at once, each in its own worker thread. The work is
// CPU-bound (DuckDB read and analysis), one core per session. At most 8 by
// default: on 41 sessions 8 jobs took 65 s against 286 s serial (4.4x) at
// 4.7 GB, while 22 only reached 45 s at 7.3 GB, too much on a VR PC.
const jobs = Math.max(
  1,
  Number(
    arg('--jobs', String(Math.max(1, Math.min(8, availableParallelism() - 2)))),
  ),
);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function readState() {
  if (!existsSync(statePath))
    return freshState({windowDays: firstWindowDays, now: new Date()});
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

// Written to a temp file and renamed over the old one, so a sync killed
// mid-write (the watcher stops it when LMU starts) never leaves a truncated
// state.json behind (pitlane #667).
function saveState(state) {
  mkdirSync(work, {recursive: true});
  const tmp = `${statePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, statePath);
}

function log(line) {
  console.log(line);
}

// Describe every recording, reusing earlier results for files that have not changed
// (sessionFiles.mjs: the scan and the grouping are shared with the curator).
function scan(state) {
  return scanFolder({folder, adapter, state, only, since, quietMin, log});
}

function group(files) {
  const sessions = groupFiles(files, ownerId);
  // What a change of analysis or of a file's size makes a different session
  // fingerprint: the unchanged ones are not analysed again.
  for (const s of sessions) {
    s.fingerprint = hash(
      versionKey(analysisVersion, blockVersions),
      ...s.files.map(f => `${f.info.source}:${f.size}`),
    );
  }
  return sessions;
}

function slugId(sim, name) {
  return `${sim}-${adapter.slug(name)}`;
}

// The track's corner map, kept once per track layout so corner numbers stay
// put from session to session. Local copy first, then the store.
const trackMaps = new Map();
// Maps an older mapVersion replaced, kept to show before and after.
const replacedMaps = new Map();
async function trackMapFor(trackId, store) {
  if (trackMaps.has(trackId)) return trackMaps.get(trackId);
  if (trackId === rebuildTrack) return null;
  const path = resolve(work, 'tracks', `${trackId}.json`);
  // A remote sync reads the curated catalog every time, never a local copy.
  let map =
    !catalogOnly && existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8'))
      : null;
  if (!map && store) map = await store.getTrack(trackId);
  // A map from an older mapVersion is no map: the session rebuilds it. Say so
  // here, not only inside the analysis, so a parallel sync runs that track
  // one session at a time and exactly one session builds the new map.
  if (map && map.mapVersion !== trackMapVersion) {
    replacedMaps.set(trackId, map);
    map = null;
  }
  trackMaps.set(trackId, map);
  return map;
}

function keepTrackMap(track) {
  trackMaps.set(track.id, track);
  mkdirSync(resolve(work, 'tracks'), {recursive: true});
  writeFileSync(
    resolve(work, 'tracks', `${track.id}.json`),
    JSON.stringify(track, null, 2),
  );
}

// The layout's corner boundaries (src/analysis/cornerBoundaries.ts), one doc
// per track next to the map: where every section's window starts, and the
// onsets of every session's laps those starts rest on. A session folds its
// own onsets in and is cut at the result (layoutBoundaries.mjs). Local copy
// first, then the store; kept unpacked here, packed on disk and in the store.
const boundaryStates = new Map();
const boundariesPath = trackId =>
  resolve(work, 'tracks', `${trackId}.boundaries.json`);
async function boundariesFor(trackId, store) {
  if (boundaryStates.has(trackId)) return boundaryStates.get(trackId);
  const path = boundariesPath(trackId);
  let doc =
    !catalogOnly && existsSync(path)
      ? JSON.parse(readFileSync(path, 'utf8'))
      : null;
  if (!doc && store) doc = await store.getBoundaries(trackId);
  const state = doc ? unpackState(doc) : null;
  boundaryStates.set(trackId, state);
  return state;
}

// The state of a track's curated data in the catalog this run read, once per
// track (catalogStamp.mjs): what a session is recorded as analysed under.
const catalogStamps = new Map();
async function stampFor(trackId, store) {
  if (!catalogStamps.has(trackId))
    catalogStamps.set(
      trackId,
      catalogStamp(
        await trackMapFor(trackId, store),
        await boundariesFor(trackId, store),
      ),
    );
  return catalogStamps.get(trackId);
}

function keepBoundaries(trackId, state) {
  boundaryStates.set(trackId, state);
  mkdirSync(resolve(work, 'tracks'), {recursive: true});
  writeFileSync(boundariesPath(trackId), JSON.stringify(packState(state)));
}

// Which online event a session and each of its recordings were part of.
function eventsOf(s, eventWindows) {
  const recordings = s.files.map(f => ({
    id: f.id,
    event: adapter.eventFor(eventWindows, f.info.recordedAt),
  }));
  const event = recordings.find(r => r.event)?.event ?? null;
  const ids = new Set(recordings.map(r => r.event?.eventId).filter(Boolean));
  // One session spanning two events means the grouping or a window is wrong.
  if (ids.size > 1)
    log(`  warning: ${s.id} spans events ${[...ids].join(', ')}`);
  return {
    session: {
      id: s.id,
      series: event?.series ?? null,
      eventId: event?.eventId ?? null,
    },
    recordings,
  };
}

function build(
  s,
  trackMap,
  boundaries,
  eventWindows,
  {fresh = [], foldOnly = false} = {},
) {
  const dir = resolve(work, 'archive', s.id);
  mkdirSync(dir, {recursive: true});
  const first = s.files[0].info;
  const sim = first.sim;
  const files = [];
  const recs = [];
  const archived = [];
  const recordings = [];
  const joined = eventsOf(s, eventWindows);
  for (const [k, f] of s.files.entries()) {
    const samples = resolve(dir, `${f.id}.samples.parquet`);
    const events = resolve(dir, `${f.id}.events.parquet`);
    // An archive the fold pass of this very run just wrote is not written again.
    if (!fresh.includes(samples))
      adapter.writeArchive(f.path, f.info, samples, events);
    archived.push(samples);
    const prefix = `archive/${sim}/${s.id}/${f.id}`;
    files.push({local: samples, dest: `${prefix}/samples.parquet`});
    files.push({local: events, dest: `${prefix}/events.parquet`});
    recs.push(loadRecording(f.info, samples, events));
    const {_channels, _events, ...info} = f.info;
    recordings.push({
      ...info,
      // The online event this recording was part of, or null offline.
      event: joined.recordings[k].event,
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

  const last = s.files[s.files.length - 1].info;
  const endMs = Date.parse(last.recordedAt) + (last.endT - last.startT) * 1000;
  const span = {
    tracks: [first.track, first.layout],
    startMs: Date.parse(first.recordedAt),
    endMs,
  };
  // The car's damage from the live capture, to tell a repair from a penalty
  // (pitVisit.mjs); null where the capture is gone.
  const damage = foldOnly ? null : damageFor(captureRoot, span);
  const a = analyzeSession(recs, {
    trackMap,
    boundaries,
    sessionId: s.id,
    foldOnly,
    carDamage: damage,
    sessionType: first.sessionType,
    splitFiles: simName === 'iracing',
    catalogOnly,
  });
  if (foldOnly) return {a, archived};
  const track = {name: first.track, variant: first.layout};
  const trackId = slugId(sim, first.layout);
  // A new corner map is stored as the track's own doc, where custom sectors
  // and official turn names can attach later.
  const trackDoc = a.newTrackMap
    ? plain({
        id: trackId,
        ownerId,
        sim,
        track,
        ...a.trackMap,
        source: {sessionId: s.id, builtAt: new Date().toISOString()},
        analysisVersion,
      })
    : null;
  const car = {name: first.car, class: first.carClass};
  const carId = slugId(sim, first.car);
  const lapId = lap =>
    `${s.files[lap.rec].id}-${String(lap.index).padStart(3, '0')}`;

  // Every car in the session, when tools/capture recorded it (field.mjs).
  const fieldOut = fieldFor(
    captureRoot,
    span,
    recs.map(r => ({t: r.s.t, lapDist: r.s.lap_dist_m})),
  );
  // Traffic around the player per lap, from the field (lapTraffic.mjs). The
  // windows go out with the laps: a sync without the capture reads the
  // uploaded field with them (store.mjs).
  const lapWindows = a.laps.map(lap => ({from: lap.startT, to: lap.endT}));
  const tags = fieldOut.field ? lapTraffic(fieldOut.field, lapWindows) : null;

  const traces = [];
  const laps = a.laps.map((lap, k) => {
    const rec = s.files[lap.rec].info;
    const id = lapId(lap);
    const tracePath = `traces/${ownerId}/${id}/v2.csv.gz`;
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
      // 'grid' (the parked car and the roll to the line), 'file' (cut by a
      // recording boundary), or null.
      partialWhy: lap.partialWhy,
      // A lap cut short by a reset to the garage, and the first lap after one.
      endedInReset: lap.endedInReset,
      afterReset: lap.afterReset,
      incomplete: lap.partial || !lap.timed,
      pitlane: lap.pitlane,
      pitIn: lap.pitIn,
      pitOut: lap.pitOut,
      offtrack: lap.offtrack,
      offTrackSec: lap.offTrackSec,
      pastEdgeSec: lap.pastEdgeSec,
      impactMax: lap.impactMax,
      // The fastest recorded speed sample of the lap, and where.
      maxSpeedKmh: lap.maxSpeedKmh,
      maxSpeedAtM: lap.maxSpeedAtM,
      sectors: lap.sectors,
      stint: lap.stint,
      comparable: lap.comparable,
      clean: lap.clean,
      reasons: lap.reasons,
      distanceM: lap.distanceM,
      // Conditions, and per-corner facts through the track's corners: what
      // src/analysis/consistency.ts needs to rerun on any selection.
      stintLap: lap.stintLap,
      start: lap.start,
      // Per wheel (FL FR RL RR): wear at the end of the lap, the lap's median
      // pressure and temperatures, and the wheels changed in the stop that
      // ended during it (tyres.mjs); null without the channels. The lap after
      // a change is the first on new tyres (consistency's cold-tyres rule).
      tyres: lap.tyres,
      tyreCarcassC: lap.tyreCarcassC,
      courseYellowSec: lap.courseYellowSec,
      compound: lap.compound,
      wetness: lap.wetness,
      corners: lap.corners || [],
      // The start straight, and the layout's boundary rev these corner times
      // were cut at (a lap on an older rev is re-analysed, never compared).
      startStraight: lap.startStraight ?? null,
      cornerBoundaries: lap.cornerBoundaries ?? null,
      // Fuel and Virtual Energy used on the lap, added back across a stop
      // (fuelFacts.mjs), and the pit stop entered during it; null without
      // the channels or a stop.
      fuel: lap.fuel,
      pitStop: lap.pitStop,
      // The battery and motor energy of the lap (hybrid.mjs); null on a car
      // without a hybrid.
      hybrid: lap.hybrid,
      // Cars around the player, seconds and counts (fieldTags.mjs); null
      // when the session has no field.
      traffic: tags?.[k] ?? null,
      // Not in the default "normal racing" selection, and why.
      excluded: lap.excluded,
      // Against the session's normal racing laps: residual to the pace
      // trend, and where an off-pace lap lost its time.
      consistency: lap.consistency,
      trace: {path: tracePath, rows: lap.i1 - lap.i0 + 1},
      analysisVersion,
    });
  });

  // Every lap's window around every corner, one file per corner
  // (cornerSlices.mjs). Named by content like the field, so a resync never
  // serves a stale cached slice.
  const slices = buildCornerSlices(
    a.laps.map(lap => ({id: lapId(lap), csv: () => a.trace(lap)})),
    a.trackMap,
    a.windows,
  );
  const slicePrefix = slices
    ? `slices/${ownerId}/${s.id}/${slices.hash}`
    : null;

  // Named by its content, so the route can cache it as immutable: a resync
  // that changes the field writes a new file (pitlane #680).
  const fieldText = fieldOut.field ? JSON.stringify(fieldOut.field) : null;
  const fieldHash = fieldText
    ? createHash('sha1').update(fieldText).digest('hex').slice(0, 12)
    : null;
  const fieldPath = fieldHash
    ? `field/${ownerId}/${s.id}/${fieldHash}.json.gz`
    : null;
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
    series: joined.session.series,
    eventId: joined.session.eventId,
    startedAt: first.recordedAt,
    endedAt: new Date(endMs).toISOString(),
    recordingIds: s.files.map(f => f.id),
    ...a.summary,
    bestLapId: a.best ? lapId(a.best) : null,
    // The analysis names laps by index; the stored docs use lap ids.
    consistency: {
      ...a.consistency,
      stints: a.consistency.stints.map(st => ({
        ...st,
        lapIds: st.lapIds.map(i => laps[Number(i)].id),
      })),
    },
    // Where the corners came from: the track's stored map, a new stored map
    // made from this session, or a map of this session's own (not stored:
    // too few clean laps, or the stored map does not fit).
    trackMapSource: a.trackMapSource,
    trackMapMismatch: a.trackMapMismatch,
    // The layout's corner boundaries these laps were cut at (rev), null on a
    // map of this session's own.
    cornerBoundaries: a.boundaries
      ? {v: a.boundaries.state.v, rev: a.boundaries.state.rev}
      : null,
    // Start fuel, the fill limit and the tank in litres (fuelFacts.mjs); the
    // limit and tank are null when the car setup is missing.
    fuel: a.fuel,
    band: a.band
      ? {
          path: `bands/${ownerId}/${s.id}/v1.json.gz`,
          stepM: a.band.stepM,
          lengthM: a.band.lengthM,
          laps: a.band.laps,
        }
      : null,
    field: fieldPath
      ? {path: fieldPath, hash: fieldHash, ...fieldOut.meta}
      : null,
    // Lap times by class, from the field (src/analysis/classLaps.ts); null
    // without one.
    classLaps: fieldOut.field
      ? classLapsDoc(fieldOut.field, first.sessionType)
      : null,
    // The player's finishing position in a race, from the same field
    // (src/analysis/raceResult.ts); null without one and outside a race.
    result: fieldOut.field
      ? finishDoc(fieldOut.field, first.sessionType)
      : null,
    // Per-corner slices of every lap (cornerSlices.mjs): the corner numbers
    // with a file at {prefix}/c{n}.json.gz, and the window they cover.
    slices: slices
      ? {
          format: SLICE_FORMAT,
          hash: slices.hash,
          prefix: slicePrefix,
          corners: slices.corners,
          beforeM: SLICE_BEFORE_M,
          afterM: SLICE_AFTER_M,
          stepM: GRID_STEP_M,
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
      maxSpeedKmh: lap.maxSpeedKmh,
      endedInReset: lap.endedInReset,
      afterReset: lap.afterReset,
      excluded: lap.excluded,
      offPace: lap.consistency?.offPace ?? null,
    })),
    analysisVersion,
    updatedAt: new Date().toISOString(),
  });

  return {
    session,
    recordings,
    laps,
    lapWindows,
    band: a.band,
    fieldText,
    slices,
    fieldReason: fieldOut.reason,
    track: trackDoc,
    // The layout's boundaries when this session changed them, to be kept.
    boundaries:
      a.boundaries && a.boundaries.changed
        ? {
            trackId,
            state: a.boundaries.state,
            windows: a.boundaries.windows,
            moved: a.boundaries.moved,
          }
        : null,
    boundariesRev: a.boundaries ? a.boundaries.state.rev : null,
    traces,
    files,
  };
}

function writeLocal(out) {
  // The same shape check the upload runs (docShape.mjs), so a local run, the
  // one a worktree can do without credentials, fails on what Firestore would.
  checkDoc(`sessions/${out.session.id}`, out.session);
  for (const rec of out.recordings) checkDoc(`recordings/${rec.id}`, rec);
  for (const lap of out.laps) checkDoc(`laps/${lap.id}`, lap);
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
  if (out.fieldText) writeFileSync(resolve(dir, 'field.json'), out.fieldText);
  if (out.slices) {
    mkdirSync(resolve(dir, 'slices'), {recursive: true});
    for (const f of out.slices.files)
      writeFileSync(resolve(dir, 'slices', `c${f.n}.json`), f.text);
  }
  if (out.track)
    writeFileSync(
      resolve(dir, 'track.json'),
      JSON.stringify(out.track, null, 2),
    );
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
  // A session uploaded for another account counts as new for this one.
  const forgotten = forgetOtherOwners(state, ownerId);
  if (forgotten)
    log(`${forgotten} session(s) were uploaded for another account: new here`);
  // "Upload older sessions…" in the tray: the first-run window is lifted once.
  if (existsSync(olderRequestPath)) {
    liftWindow(state);
    // Removed before the sync runs on purpose: the lift is saved with the
    // state right after the scan, so a sync stopped for the game keeps it.
    if (!check) rmSync(olderRequestPath);
    log('older sessions included');
  }
  if (!since && state.since) since = state.since;
  const files = scan(state);
  if (!check) saveState(state);
  const sessions = group(files);
  log(`${files.length} recordings in ${sessions.length} sessions (${folder})`);

  if (flag('--list')) {
    for (const s of sessions) log(`${s.id} ${describeSession(s)}`);
    return;
  }

  const eventWindows = adapter.readEventWindows({
    logFolder,
    cachePath: resolve(work, 'events.json'),
  });
  log(`${eventWindows.length} online event joins known`);

  let store = null;
  if (!local) store = remoteStore ?? (await import('./store.mjs'));

  if (flag('--events-only')) {
    const items = sessions
      .filter(s => state.sessions[s.id])
      .map(s => eventsOf(s, eventWindows));
    for (const {session, recordings} of items) {
      if (!session.series) continue;
      const gaps = recordings.map(r => r.event?.gapS ?? '-').join(' ');
      log(`${session.id} ${session.series} (gap s: ${gaps})`);
    }
    const failed = local ? [] : await store.updateEvents(items);
    for (const line of failed) log(`  failed: ${line}`);
    log(
      `events set on ${items.length} uploaded sessions, ${
        items.filter(i => i.session.series).length
      } online, ${failed.length} writes failed`,
    );
    if (failed.length) process.exitCode = 1;
    return;
  }

  // Newest first: recent sessions matter most, and a long backfill fills in
  // the past last.
  state.revs ??= {};
  state.stamps ??= {};
  // A session whose corner times were cut at boundaries that have since moved
  // is re-analysed, even though nothing about its files changed.
  const boundariesMoved = async s => {
    const rev = (await boundariesFor(trackOf(s), store))?.rev;
    return staleRev(state.revs[s.id], rev);
  };
  const stale = new Set();
  if (!force && !local) {
    for (const s of sessions) {
      // --check evaluates every session, so a throw here shows even on a
      // machine whose state has not seen them yet.
      const same = state.sessions[s.id] === s.fingerprint;
      if ((same || check) && (await boundariesMoved(s)) && same)
        stale.add(s.id);
    }
  }
  // A remote sync reads the curated catalog and re-analyses the sessions
  // whose track changed in it (a map added, a map edited), per track, capped
  // per run, newest first. The stamp is read once per track from the catalog.
  const stamps = new Map();
  const catalogStale = new Set();
  if (catalogOnly && !force && !check) {
    const synced = [...sessions]
      .reverse()
      .filter(s => state.sessions[s.id] === s.fingerprint)
      .map(s => ({id: s.id, trackId: trackOf(s)}));
    for (const {trackId} of synced)
      if (!stamps.has(trackId))
        stamps.set(trackId, await stampFor(trackId, store));
    const found = staleByCatalog({
      sessions: synced,
      stamps: state.stamps,
      current: stamps,
      cap: resyncCap,
    });
    for (const [id, stamp] of found.adopt) state.stamps[id] = stamp;
    if (found.adopt.size) saveState(state);
    for (const id of found.stale) catalogStale.add(id);
    if (catalogStale.size)
      log(
        `${catalogStale.size} session(s) on a track whose curated data changed`,
      );
    if (found.deferred)
      log(
        `${found.deferred} more wait for a later run (cap ${resyncCap} per run)`,
      );
  }
  let todo = [...sessions]
    .reverse()
    .filter(
      s =>
        force ||
        local ||
        state.sessions[s.id] !== s.fingerprint ||
        stale.has(s.id) ||
        catalogStale.has(s.id),
    );
  if (stale.size) log(`${stale.size} session(s) on older corner boundaries`);
  const waiting = todo.filter(s => skipIds.has(s.id));
  if (waiting.length) {
    log(`${waiting.length} session(s) waiting on a retry: skipped`);
    todo = todo.filter(s => !skipIds.has(s.id));
  }
  // The watcher reads this line for the heartbeat's done/total.
  log(`to do ${todo.length}`);
  // Fold first, then cut: every session of a track with a map has its onsets
  // folded into the layout's boundaries before any is analysed, so each is cut
  // once, at the boundaries they settle on. Sessions already counted (a resync
  // of one, a session folded by an earlier run) are skipped; a track without a
  // map yet is built by its first session in the main pass, the rest settle.
  const needFold = [];
  // A remote sync folds nothing: the boundaries are the curator's.
  for (const s of catalogOnly ? [] : todo) {
    const trackId = trackOf(s);
    if (!(await trackMapFor(trackId, store))) continue;
    const kept = await boundariesFor(trackId, store);
    if (kept?.sessions?.[s.id]) continue;
    needFold.push(s);
  }
  if (check) {
    log(
      `check ok: ${sessions.length} sessions, ${todo.length} to do, ${stale.size} on older boundaries, ${needFold.length} to fold`,
    );
    return;
  }
  let fresh = [];
  let foldCount = 0;
  if (needFold.length > 1) {
    log(`${needFold.length} session(s) folded into corner boundaries first`);
    // The watcher's total grows by what is folded first; each fold prints a
    // session line like the pass after it.
    log(`to do ${todo.length + needFold.length}`);
    const folded = await runPool([...needFold], store, state, eventWindows, {
      mode: 'fold',
    });
    fresh = folded.archived;
    foldCount = folded.done + folded.failed;
    // What the fold pass settled on is stored before any session is cut at it.
    if (!local && folded.done > 0) {
      for (const trackId of new Set(needFold.map(trackOf))) {
        const kept = await boundariesFor(trackId, store);
        const map = await trackMapFor(trackId, store);
        if (kept && map) {
          await store.putBoundaries({
            trackId,
            state: kept,
            windows: windowsOf(kept, map.corners, map.lengthM),
          });
        }
      }
    }
  }
  const first = await runPool(todo, store, state, eventWindows, {fresh});
  // Sessions analysed before a later one moved their layout's boundaries were
  // cut at the old ones: once more, now that the boundaries have settled (a
  // session already counted in them folds in nothing new, so this ends).
  const redo = first.processed
    .filter(
      p =>
        p.rev != null && p.rev < (boundaryStates.get(trackOf(p.s))?.rev ?? 0),
    )
    .map(p => p.s);
  let done = first.done;
  let failed = first.failed;
  const tracks = first.tracks;
  if (redo.length) {
    log(`${redo.length} session(s) cut at boundaries that moved: again`);
    // The watcher's total grows by what is redone; its progress goes on.
    log(`to do ${foldCount + first.done + first.failed + redo.length}`);
    const again = await runPool(redo, store, state, eventWindows);
    done += again.done;
    failed += again.failed;
    again.tracks.forEach(t => tracks.add(t));
  }
  log(
    `done ${done}, failed ${failed}, unchanged ${
      sessions.length - first.done - first.failed
    }`,
  );
  if (failed) process.exitCode = 1;
  if (foldsSurface({local, remote, tracks: tracks.size}))
    await foldSurfaceAfterSync([...tracks]);
}

// The tracks just uploaded get their new sessions folded into the measured
// surface (tools/sessions/surface.mjs, pit-wall thread 40), so it never needs
// a hand-run. It reads what was just stored and skips sessions already
// folded. It is after the closing "done" line, and a failure is a log line the
// watcher does not read as a failed session: the sync itself succeeded.
async function foldSurfaceAfterSync(trackIds) {
  try {
    const {foldSurfaces} = await import('./surface.mjs');
    await foldSurfaces({trackIds, log});
  } catch (error) {
    const message = String(error?.message ?? error).split(/\r?\n/)[0];
    log(`surface: not updated: ${message}`);
  }
}

const trackOf = s => slugId(s.files[0].info.sim, s.files[0].info.layout);

// Hand sessions to workers in order. A track without a corner map yet takes
// one session at a time, so the first session there builds the map and the
// rest use it, as they would one by one.
async function runPool(
  todo,
  store,
  state,
  eventWindows,
  {mode = 'full', fresh = []} = {},
) {
  const folding = mode === 'fold';
  const archived = [];
  let done = 0;
  let failed = 0;
  const tracks = new Set();
  const processed = [];
  const building = new Set();
  const waiting = [];
  const changed = () => waiting.splice(0).forEach(wake => wake());
  const take = () => {
    const i = todo.findIndex(s => !building.has(trackOf(s)));
    if (i < 0) return null;
    const [s] = todo.splice(i, 1);
    building.add(trackOf(s));
    return s;
  };
  const drive = async member => {
    for (;;) {
      const s = take();
      if (!s) {
        if (!todo.length) return;
        await new Promise(wake => waiting.push(wake));
        continue;
      }
      const trackId = trackOf(s);
      const trackMap = await trackMapFor(trackId, store);
      // One session of a track at a time: each folds its onsets into the
      // layout's boundaries and is cut at the result, so two at once would
      // each fold into the same stored state and lose one of them.
      const boundaries = await boundariesFor(trackId, store);
      const r = await ask(member, {
        op: mode,
        s,
        trackMap,
        boundaries,
        eventWindows,
        fresh,
      });
      if (r.archived) archived.push(...r.archived);
      if (r.track) keepTrackMap(r.track);
      if (r.boundaries) keepBoundaries(trackId, r.boundaries.state);
      building.delete(trackId);
      changed();
      for (const line of r.lines) log(line);
      // Corner numbers must stay stable across a rebuild; show the replaced
      // map next to the new one so a renumbering is seen, not found later.
      if (r.track && replacedMaps.has(trackId)) {
        log(`  corners before: ${mapSummary(replacedMaps.get(trackId))}`);
        log(`  corners after:  ${mapSummary(r.track)}`);
      }
      if (r.ok && folding) {
        done++;
      } else if (r.ok) {
        done++;
        tracks.add(trackId);
        processed.push({s, rev: r.rev});
        if (!local) {
          markDone(state, s.id, s.fingerprint, ownerId);
          if (r.rev != null) state.revs[s.id] = r.rev;
          if (catalogOnly) state.stamps[s.id] = await stampFor(trackId, store);
          saveState(state);
        }
      } else {
        failed++;
        log(`  failed: ${r.error.split('\n').slice(0, 3).join(' | ')}`);
        if (r.dead) return;
      }
    }
  };
  const workers = Array.from(
    {length: Math.min(jobs, todo.length)},
    () => new Worker(new URL(import.meta.url), {argv: process.argv.slice(2)}),
  );
  await Promise.all(workers.map(drive));
  await Promise.all(workers.map(w => w.terminate()));
  // Every worker died: what is left was not attempted, and is not unchanged.
  if (todo.length)
    log(`${todo.length} session(s) not attempted: no workers left`);
  return {done, failed: failed + todo.length, tracks, processed, archived};
}

function ask(thread, message) {
  return new Promise(done => {
    const onError = error => {
      thread.off('message', onMessage);
      done({ok: false, dead: true, lines: [], error: String(error.stack)});
    };
    const onMessage = reply => {
      thread.off('error', onError);
      done(reply);
    };
    thread.once('message', onMessage);
    thread.once('error', onError);
    thread.postMessage(message);
  });
}

// A corner map in one line: each section, its parts' apex distances.
function mapSummary(map) {
  return map.corners
    .map(c => `S${c.n} [${(c.parts ?? [c]).map(p => p.apexM).join(' ')}]`)
    .join(' ');
}

// One session, built and stored. Its log lines come back together, so
// sessions running side by side do not interleave in the output.
async function processSession(
  s,
  trackMap,
  boundaries,
  eventWindows,
  store,
  lines,
  fresh = [],
) {
  lines.push(`${s.id} ${describeSession(s)}`);
  const out = build(s, trackMap, boundaries, eventWindows, {fresh});
  // The analysis is told not to make track data; if any ever comes out, it
  // must not go anywhere.
  if (catalogOnly && (out.track || out.boundaries))
    throw new Error(
      'a remote sync produced track data: refusing to keep or upload it',
    );
  const trackId = trackOf(s);
  if (out.track) {
    lines.push(
      `  new corner map for ${trackId}: ${out.track.corners.length} corners, from this session`,
    );
  }
  if (out.session.trackMapMismatch) {
    lines.push(
      `  stored corner map for ${trackId} does not fit this session's lap; analyzed with a map of its own, not stored`,
    );
  }
  if (out.boundaries) {
    lines.push(
      `  corner boundaries for ${trackId}: rev ${out.boundaries.state.rev}, ${
        out.boundaries.windows.length
      } windows${out.boundaries.moved ? ' (moved)' : ''}`,
    );
  }
  if (out.session.series)
    lines.push(`  ${out.session.series} ${out.session.eventId}`);
  const f = out.session.field;
  lines.push(
    f
      ? `  field: ${f.cars} cars, ${f.durationS} s, player aligned to ${f.alignM} m`
      : `  field: none (${out.fieldReason})`,
  );
  lines.push(
    `  ${out.laps.length} laps, ${
      out.session.comparableCount
    } comparable, best ${out.session.bestLapTime ?? '-'}`,
  );
  if (out.session.consistency?.overview) {
    lines.push(`  ${out.session.consistency.overview}`);
  }
  if (local) lines.push(`  -> ${writeLocal(out)}`);
  else await store.upload(out, {log: line => lines.push(line)});
  return {
    track: out.track,
    boundaries: out.boundaries,
    rev: out.boundariesRev,
  };
}

async function worker() {
  const store = local ? null : remoteStore ?? (await import('./store.mjs'));
  parentPort.on('message', async message => {
    const {op, s, trackMap, boundaries, eventWindows, fresh} = message;
    const lines = [];
    try {
      // The fold pass: this session's onsets into the layout's boundaries,
      // nothing analysed past them, nothing uploaded.
      if (op === 'fold') {
        lines.push(`${s.id} fold: ${describeSession(s)}`);
        const {a, archived} = build(s, trackMap, boundaries, eventWindows, {
          foldOnly: true,
        });
        parentPort.postMessage({
          ok: true,
          lines,
          boundaries: a.boundaries?.changed
            ? {trackId: trackOf(s), ...a.boundaries}
            : null,
          archived,
        });
        return;
      }
      const done = await processSession(
        s,
        trackMap,
        boundaries,
        eventWindows,
        store,
        lines,
        fresh,
      );
      parentPort.postMessage({ok: true, lines, ...done});
    } catch (error) {
      parentPort.postMessage({
        ok: false,
        lines,
        error: String(error.stack || error),
      });
    }
  });
}

if (isMainThread) await main();
else await worker();
