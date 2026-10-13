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
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import {availableParallelism, homedir} from 'node:os';
import {Worker, isMainThread, parentPort} from 'node:worker_threads';
import {resolve} from 'node:path';
import {adapter as adapterOf, telemetryFolder} from './sims.mjs';
import {
  groupFiles,
  hash,
  QUIET_MIN_DEFAULT,
  scanFolder,
} from './sessionFiles.mjs';
import {versionKey} from './versionKey.mjs';
import {analyzeFromArchive, slugId} from './analyzeFromArchive.mjs';
import {analysisVersion, blockVersions, trackMapVersion} from './analyze.mjs';
import {fieldFor} from './field.mjs';
import {capturesRead, markUploaded} from './captureMarker.mjs';
import {describeCheck, ibtCrossings, liveLapCheck} from './irCapture.mjs';
import {irFieldFor} from './irField.mjs';
import {driversOfYaml} from './irClasses.mjs';
import {openIbt} from './ibt.mjs';
import {damageFor} from './playerDamage.mjs';
import {raceLengthFor} from './raceLength.mjs';
import {captureExtract} from './captureExtract.mjs';
import {repairArchives} from './archiveRepair.mjs';
import {checkDoc} from './docShape.mjs';
import {packState, unpackState} from './layoutBoundaries.mjs';
import {planBlock} from './planBlock.mjs';
import {
  forgetOtherOwners,
  freshState,
  markDone,
  uploadDue,
} from './syncState.mjs';

import {openRemoteStore} from './remoteStore.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const flag = name => process.argv.includes(name);

const simName = arg('--sim', process.env.LAP_SIM || 'lmu');
const adapter = adapterOf(simName);
const folder = arg('--folder', telemetryFolder(simName));
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
const only = arg('--only', '');
// Session ids to leave alone this pass: the watcher's failed sessions still
// waiting on their backoff.
const skipIds = new Set(arg('--skip', '').split(',').filter(Boolean));
const local = flag('--local');
const check = flag('--check');
const force = flag('--force');
const quietMin = Number(arg('--quiet-min', String(QUIET_MIN_DEFAULT)));
// Replace this track's stored corner map with one built from the next
// session analyzed there. Corner numbers change for every session after it.
const rebuildTrack = arg('--rebuild-track', '');
const work = resolve(
  arg('--work', resolve(process.env.LOCALAPPDATA || homedir(), 'lap-sessions')),
);
const statePath = resolve(work, 'state.json');
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
    const sources = s.files.map(f => `${f.info.source}:${f.size}`);
    s.fingerprint = hash(
      versionKey(analysisVersion, blockVersions),
      ...sources,
    );
    // The recordings alone: what makes an upload due again (uploadDue).
    s.sources = hash(...sources);
  }
  return sessions;
}

// Every car's class in an iRacing session, from its .ibt (irClasses.mjs);
// none when the file can't be read.
function ibtDriversOf(path) {
  try {
    const ibt = openIbt(path);
    try {
      return driversOfYaml(ibt.yaml);
    } finally {
      ibt.close();
    }
  } catch {
    return [];
  }
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

// The session's track and wall-clock window, the key a capture joins on.
function spanOf(s) {
  const first = s.files[0].info;
  const last = s.files[s.files.length - 1].info;
  return {
    tracks: [first.track, first.layout],
    startMs: Date.parse(first.recordedAt),
    endMs: Date.parse(last.recordedAt) + (last.endT - last.startT) * 1000,
  };
}

// Sessions uploaded before the tray kept capture extracts, whose capture is
// still on the PC: their extract goes up once, by itself, with no analysis
// (pit-wall thread 1 #4611, #4613). Recorded in state.extracts so a session
// is sent once.
async function uploadCaptureBacklog(sessions, state, store) {
  state.extracts ??= {};
  let sent = 0;
  for (const s of sessions) {
    if (!state.sessions[s.id] || state.extracts[s.id]) continue;
    const span = spanOf(s);
    const first = s.files[0].info;
    const extract = captureExtract({
      damage: damageFor(captureRoot, span),
      raceLength:
        first.sim === 'lmu' && /^r/i.test(first.sessionType)
          ? raceLengthFor(captureRoot, span)
          : null,
    });
    // No capture on the PC: nothing to keep, and nothing to try again.
    if (extract) {
      await store.putCaptureExtract(ownerId, s.id, extract);
      sent++;
    }
    // Saved per session, so a run stopped mid-backlog resumes where it was.
    state.extracts[s.id] = extract ? 'sent' : 'none';
    saveState(state);
  }
  if (sent) log(`capture extracts kept for ${sent} uploaded session(s)`);
}

// The one-time repair of iRacing archives written with guessed types
// (archiveRepair.mjs).
async function repairIracingArchives(sessions, state, store) {
  if (simName !== 'iracing') return;
  const repaired = await repairArchives({
    sessions,
    state,
    store,
    writeArchive: adapter.writeArchive,
    dir: resolve(work, 'repair'),
    save: () => saveState(state),
    sim: simName,
    ownerId,
    log,
  });
  if (repaired) log(`iRacing archives repaired for ${repaired} session(s)`);
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

  const span = spanOf(s);
  // iRacing: the tray's live capture against the .ibt of the same drive, lap
  // by lap. Only logged: a lap over 5 ms apart is the news (apex #2958).
  // Every capture this session read (field, damage, race length, the player
  // stream): once it is uploaded they are the tray's to prune.
  const capturesUsed = foldOnly ? [] : capturesRead(captureRoot, sim, span);
  const liveCheck =
    foldOnly || sim !== 'iracing'
      ? null
      : liveLapCheck(captureRoot, span, ibtCrossings(s.files.map(f => f.path)));
  // The car's damage from the live capture, to tell a repair from a penalty
  // (pitVisit.mjs); null where the capture is gone.
  const damage = foldOnly ? null : damageFor(captureRoot, span);
  // How long the race is: {minutes}. LMU: from the capture, null where it is gone.
  // iRacing: from the .ibt's session info. Null for other sessions.
  const ibtDrivers =
    !foldOnly && sim === 'iracing' ? ibtDriversOf(s.files[0].path) : [];
  const raceLength =
    foldOnly || !/^r/i.test(first.sessionType)
      ? null
      : sim === 'iracing'
      ? first.raceLength ?? null
      : raceLengthFor(captureRoot, span);
  const out = analyzeFromArchive({
    ownerId,
    sessionId: s.id,
    recordings: s.files.map(f => ({
      id: f.id,
      info: f.info,
      samplesPath: resolve(dir, `${f.id}.samples.parquet`),
      eventsPath: resolve(dir, `${f.id}.events.parquet`),
    })),
    trackMap,
    boundaries,
    catalogOnly,
    foldOnly,
    damage,
    raceLength,
    event: joined.session,
    // Every car in the session, when the recorder ran (field.mjs, irField.mjs).
    fieldFor: lite =>
      (sim === 'iracing' ? irFieldFor : fieldFor)(
        captureRoot,
        span,
        lite,
        ibtDrivers,
      ),
  });
  if (foldOnly) return {a: out.a, archived};
  return {
    ...out,
    recordings,
    // iRacing: every car's class from the .ibt, so a stored field from before
    // the field carried classes gets them (store.mjs, irClasses.relabelField).
    ibtDrivers,
    liveCheck,
    // The capture's damage and race length, kept in the store for analysis
    // on open once the capture is pruned (captureExtract.mjs).
    captureExtract: captureExtract({
      damage,
      raceLength: sim === 'lmu' ? raceLength : null,
    }),
    capturesUsed,
    files,
  };
}

function writeLocal(out) {
  // A local run has no stored docs to keep from, so its plan is the fresh one;
  // an upload's is written by store.mjs.
  out.session.plan = planBlock({
    sessionType: out.session.sessionType,
    fuel: out.session.fuel,
    laps: out.laps,
    race: out.session.race,
    result: out.session.result,
  });
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
  // the past last. A session is analysed here the first time it is seen, and
  // again only when its recordings changed. A change of analysis rules or of
  // the curated track never re-syncs a stored session: it reads stale, and
  // opening it analyses it again in the cloud (pit-wall thread 1 #4611).
  let todo = [...sessions]
    .reverse()
    .filter(s => force || local || uploadDue(s, state));
  const waiting = todo.filter(s => skipIds.has(s.id));
  if (waiting.length) {
    log(`${waiting.length} session(s) waiting on a retry: skipped`);
    todo = todo.filter(s => !skipIds.has(s.id));
  }
  if (!local && !check) await uploadCaptureBacklog(sessions, state, store);
  if (!local && !check) await repairIracingArchives(sessions, state, store);
  // The watcher reads this line for the heartbeat's done/total.
  log(`to do ${todo.length}`);
  // A sync never writes a track. Boundaries and the surface are rebuilt by
  // curate from a named set (tools/curate, tools/sessions/surface.mjs).
  if (check) {
    log(`check ok: ${sessions.length} sessions, ${todo.length} to do`);
    return;
  }
  const first = await runPool(todo, store, state, eventWindows);
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
    log(`to do ${first.done + first.failed + redo.length}`);
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
          markDone(state, s.id, s.fingerprint, ownerId, s.sources);
          state.extracts ??= {};
          // Its extract, if the capture gave one, went up with it.
          state.extracts[s.id] = 'with-session';
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
  if (out.liveCheck) lines.push(`  ${describeCheck(out.liveCheck)}`);
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
  else {
    await store.upload(out, {log: line => lines.push(line)});
    // What the captures gave is in the store now: the tray may prune them.
    markUploaded(captureRoot, out.capturesUsed, s.id);
  }
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
