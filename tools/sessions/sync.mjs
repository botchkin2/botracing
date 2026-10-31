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
  readFileSync,
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
import {replaceFile} from './replaceFile.mjs';
import {versionKey} from './versionKey.mjs';
import {slugId} from './analyzeFromArchive.mjs';
import {analysisVersion, blockVersions, trackMapVersion} from './analyze.mjs';
import {
  dropSessionIds,
  foreignMissing,
  liveMarks,
  markUploaded,
  markVerified,
  unverifiedMarks,
} from './captureMarker.mjs';
import {describeCapture, onTrackSpanOf} from './lmuCapture.mjs';
import {noteNoField} from './noField.mjs';
import {describeCheck} from './irCapture.mjs';
import {captureExtractFor, liveExtractSessions} from './captureExtractFor.mjs';
import {resultsForSpan} from './lmuResults.mjs';
import {iracingResultsFromFile} from './irResults.mjs';
import {RESULTS_INPUT_VERSION} from './resultsInput.mjs';
import {
  IRACING_INPUT_REV,
  backlogCandidates,
  uploadResultsBacklog,
} from './resultsBacklog.mjs';
import {
  adoptLiveIds,
  claimCoveredSessions,
  confirmAdoptions,
  confirmClaims,
  coveredCopies,
  settleSupersedes,
} from './heal.mjs';
import {liveCover, readLiveIndex} from './liveSession.mjs';
import {usableLiveIndex} from './brokenWheels.mjs';
import {makeBuilder} from './buildSession.mjs';
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
// --live <captureDir>: live laps (syncLive.mjs). Only that capture's finished
// laps, as archive parts; no game files, no analysis. Remote only.
const liveDir = arg('--live', '');
if (liveDir) {
  if (!remoteStore) {
    console.error('--live uploads; it needs --remote (or LAP_API).');
    process.exit(2);
  }
  const {captureAdapterFor, syncLive} = await import('./syncLive.mjs');
  // The work folder is the sim's (watch.mjs passes --sim): a capture of another
  // sim would write its live index where that sim's sync never reads it.
  const {sim: captureSim, adapter: capture} = captureAdapterFor(
    resolve(liveDir),
  );
  if (captureSim !== simName) {
    console.error(
      `--live: the capture is ${captureSim}, this sync is --sim ${simName}.`,
    );
    process.exit(2);
  }
  const r = await syncLive({
    captureDir: resolve(liveDir),
    ownerId,
    work,
    store: remoteStore,
    capture,
    log: line => console.log(line),
  });
  console.log(`live: done ${r.sessions}`);
  process.exit(0);
}
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
  replaceFile(statePath, JSON.stringify(state));
}

function log(line) {
  console.log(line);
}

const {build, eventsOf, spanOf} = makeBuilder({
  adapter,
  work,
  ownerId,
  catalogOnly,
  captureRoot,
  log,
});

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

// Captures marked before the read-back existed or whose read-back failed,
// and captures live laps uploaded (which the live path never marks): each
// session is read back, so a capture that is stored stops counting down to
// its 14-day deletion (prune.rs) and leaves Problems.
async function verifyMarked(store) {
  let verified = 0;
  let failed = 0;
  const live = (root, name, id, readBack) =>
    Boolean(readBack?.ok) &&
    markUploaded(root, [name], id, {check: readBack}).length > 0;
  for (const [marks, record] of [
    [unverifiedMarks(captureRoot), markVerified],
    [liveMarks(captureRoot, readLiveIndex(work)), live],
  ]) {
    for (const {name, sessionIds} of marks) {
      const checks = [];
      for (const id of sessionIds) {
        const readBack = await store.verify(null, {sessionId: id});
        checks.push({
          id,
          ok: Boolean(readBack?.ok),
          missing:
            !readBack?.ok &&
            String(readBack?.reason ?? '').includes('is not in the store'),
          readBack,
        });
      }
      let span = null;
      try {
        span = onTrackSpanOf(
          describeCapture(resolve(captureRoot, name)).stretches,
        );
      } catch {
        span = null;
      }
      for (const row of checks) {
        if (!row.ok || typeof store.getSession !== 'function') continue;
        const id = row.readBack?.sessionId || row.id;
        const doc = await store.getSession(id);
        row.start = doc?.startedAt ?? null;
        row.end = doc?.endedAt ?? null;
      }
      const drop = foreignMissing(checks, span);
      const dropped = new Set(
        dropSessionIds(captureRoot, name, drop) ? drop : [],
      );
      if (dropped.size)
        log(`  ${name}: dropped ${drop.join(', ')} (not this owner)`);
      for (const row of checks) {
        if (dropped.has(row.id)) continue;
        if (record(captureRoot, name, row.id, row.readBack)) verified++;
        else {
          failed++;
          log(`  ${name}: ${row.id} not verified: ${row.readBack.reason}`);
        }
      }
    }
  }
  if (verified || failed)
    log(`read back captures: ${verified} verified, ${failed} not`);
}

// Sessions uploaded before the tray kept capture extracts, whose capture is
// still on the PC: their extract goes up once, by itself, with no analysis
// (pit-wall thread 1 #4611, #4613). Recorded in state.extracts so a session
// is sent once.
async function uploadCaptureBacklog(sessions, state, store, liveIndex) {
  state.extracts ??= {};
  let sent = 0;
  const items = [
    ...sessions
      .filter(s => state.sessions[s.id])
      .map(s => ({
        id: s.id,
        sim: s.files[0].info.sim,
        sessionType: s.files[0].info.sessionType,
        span: spanOf(s),
        live: false,
      })),
    // A live session's extract went up with its laps, before it carried the
    // online flag: sent again once, and the session marked stale so the next
    // open analyses it with the flag.
    ...liveExtractSessions(liveIndex, captureRoot).map(s => ({
      ...s,
      live: true,
    })),
  ];
  for (const s of items) {
    if (state.extracts[s.id]) continue;
    const extract = captureExtractFor(captureRoot, s.span, s);
    // No capture on the PC: nothing to keep, and nothing to try again.
    if (extract) {
      await store.putCaptureExtract(ownerId, s.id, extract);
      if (s.live) await store.markStale(s.id, ownerId);
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

// This tray start, for resultsBacklog.mjs: a session with no results file is
// looked at once per start after its retry window. The watcher passes its own.
const resultsRun = arg('--run', new Date().toISOString());

function keepResults(sessions, state, store, liveIndex) {
  const nowMs = Date.now();
  return uploadResultsBacklog({
    candidates: backlogCandidates({
      sessions,
      state,
      spanOf,
      liveIndex,
      captureRoot,
    }),
    state,
    store,
    ownerId,
    resultsForSpan,
    iracingResultsFromFile,
    saveState: () => saveState(state),
    log,
    nowMs,
    run: resultsRun,
  });
}

async function main() {
  const state = readState();
  // A session uploaded for another account counts as new for this one.
  const forgotten = forgetOtherOwners(state, ownerId);
  if (forgotten)
    log(`${forgotten} session(s) were uploaded for another account: new here`);
  if (!since && state.since) since = state.since;
  // --results-live: the same, for the live-uploaded sessions only, without
  // scanning the telemetry folder: cheap enough to run every minute while a
  // session has just ended (watch.mjs).
  if (flag('--results-live')) {
    if (local || check) {
      console.error('--results-live uploads; it needs --remote (or LAP_API).');
      process.exit(2);
    }
    const liveStore = remoteStore ?? (await import('./store.mjs'));
    await keepResults(
      [],
      state,
      liveStore,
      usableLiveIndex(readLiveIndex(work), captureRoot),
    );
    return;
  }
  const scanned = scan(state);
  if (!check) saveState(state);
  // A drive live laps already uploaded still archives its game file (audit
  // row 13). The build takes the live session's id and adds only the
  // stretches that copy lacks. A broken-wheel capture covers nothing: its
  // game file rebuilds the drive (adoptLiveIds).
  const liveIndex = usableLiveIndex(readLiveIndex(work), captureRoot);
  const files = scanned;
  const sessions = group(files);
  // A covered game file is built under the live session's id only while that
  // session is still in the store. A deleted live copy is never made again
  // (STORAGE.md). Without a store (local) nothing is claimed or adopted.
  if (remoteStore) {
    for (const s of await confirmClaims(
      claimCoveredSessions(sessions, liveIndex, liveCover),
      async id => Boolean(await remoteStore.getSession(id)),
    ))
      log(`  ${s.hashId}: game file kept with live session ${s.id}`);
    // A drive whose live capture is defective (brokenWheels.mjs) is rebuilt from
    // its game file under the live session's id (heal.mjs, thread 74 step 1).
    const adopted = adoptLiveIds(
      sessions,
      readLiveIndex(work),
      liveIndex,
      liveCover,
    );
    for (const s of await confirmAdoptions(adopted, async id =>
      Boolean(await remoteStore.getSession(id)),
    ))
      log(`  ${s.id}: the game file replaces the live copy in place`);
    // A drive's second copy, uploaded from its game file before the cover
    // rule saw its live stretch, is hidden behind the live session. Only
    // while that session exists: a deleted live copy leaves the game file's.
    const copies = coveredCopies(group(scanned), liveIndex, liveCover, id =>
      Boolean(state.sessions[id]),
    );
    for (const [oldId, liveId] of Object.entries(copies)) {
      if (!(await remoteStore.getSession(liveId))) continue;
      log(`  ${oldId}: a copy of live session ${liveId}, hidden behind it`);
      (state.pendingSupersede ??= {})[oldId] = liveId;
      delete state.sessions[oldId];
      saveState(state);
    }
  }
  // A tombstone that failed after its healed upload is tried again here.
  if (remoteStore && Object.keys(state.pendingSupersede ?? {}).length)
    await settleSupersedes(
      state.pendingSupersede,
      (oldId, byId) =>
        remoteStore.supersedeSession(oldId, byId, new Date().toISOString()),
      log,
    );
  log(`${files.length} recordings in ${sessions.length} sessions (${folder})`);

  if (flag('--list')) {
    for (const s of sessions) log(`${s.id} ${describeSession(s)}`);
    return;
  }

  // --results: only the game's results for stored sessions that lack them
  // (the watcher runs it once per tray start, resultsBacklog.mjs).
  if (flag('--results')) {
    if (local || check) {
      console.error('--results uploads; it needs --remote (or LAP_API).');
      process.exit(2);
    }
    const resultsStore = remoteStore ?? (await import('./store.mjs'));
    await keepResults(sessions, state, resultsStore, liveIndex);
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
  if (!local && !check)
    await uploadCaptureBacklog(sessions, state, store, liveIndex);
  if (!local && !check) await keepResults(sessions, state, store, liveIndex);
  if (!local && !check) await repairIracingArchives(sessions, state, store);
  if (!local && !check) await verifyMarked(store);
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
          // The healed session holds the drive now: the hand rebuild under
          // the hash id is tombstoned, after the upload and its stale stamp
          // are written, so there is never a moment with no copy.
          if (s.hashId) {
            (state.pendingSupersede ??= {})[s.hashId] = s.id;
            delete state.sessions[s.hashId];
            saveState(state);
            await settleSupersedes(
              state.pendingSupersede,
              (oldId, byId) =>
                store.supersedeSession(oldId, byId, new Date().toISOString()),
              log,
            );
          }
          state.extracts ??= {};
          // Its extract, if the capture gave one, went up with it.
          state.extracts[s.id] = 'with-session';
          // Its results input went up with it only if the game had written a
          // file; otherwise the backlog looks again (resultsBacklog.mjs).
          // An iRacing session's is the .ibt's qualifying input, under its own key.
          if (s.files[0].info.sim === 'iracing') {
            state.iracingResultsInputs ??= {};
            state.iracingResultsInputs[s.id] = {
              rev: IRACING_INPUT_REV,
              sent: Boolean(r.resultsSent),
            };
          } else if (r.resultsSent) {
            state.resultsInputs ??= {};
            state.resultsInputs[s.id] = {v: RESULTS_INPUT_VERSION};
          }
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
  out.healDefect = s.healDefect ?? null;
  out.healLack = s.healLack ?? null;
  if (local) lines.push(`  -> ${writeLocal(out)}`);
  else {
    const sent = await store.upload(out, {log: line => lines.push(line)});
    noteNoField(work, out.session, Date.now());
    // Read back before the tray may delete what the captures gave: an
    // unverified session keeps them (verifyStored.mjs).
    const readBack = await store.verify(out, {
      skipped: sent?.skipped ?? null,
    });
    lines.push(
      readBack.ok
        ? `  read back: ${readBack.laps} laps, ${
            readBack.fieldHash
              ? `field ${readBack.fieldHash}`
              : `no field (${readBack.fieldMissing})`
          }`
        : `  read back failed, captures kept: ${readBack.reason}`,
    );
    markUploaded(captureRoot, out.capturesUsed, s.id, {check: readBack});
  }
  return {
    track: out.track,
    boundaries: out.boundaries,
    rev: out.boundariesRev,
    resultsSent: Boolean(out.resultsInput),
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
