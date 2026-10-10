// Uploader watcher: syncs new LMU sessions by itself and reports its status.
//
//   node tools/uploader/watch.mjs          run until stopped (the logon task)
//   node tools/uploader/watch.mjs --once   one check, then exit
//   node tools/uploader/watch.mjs --once -- --local --work <dir>
//                                          pass the rest to sync.mjs (tests)
//
// Started at logon by the LapUploader scheduled task (install.ps1), headless,
// one instance. Every 30 s it looks at LMU's Telemetry folder and the game
// process; when to sync is in trigger.mjs (never while LMU runs). A sync is
// tools/sessions/sync.mjs in a child process at below-normal priority, so a
// crash there never takes the watcher down. Status goes to Firestore
// uploaders/{hostId} (heartbeat.mjs), on each change and at least every 5
// minutes. A crash of the PC mid-session needs nothing special: at the next
// logon the telemetry is newer than the last sync, and the watcher syncs it.
//
// Config, optional, %LOCALAPPDATA%\lap-uploader\config.json:
//   {"label": "Race PC"}   the name the app shows for this PC
import {execFileSync, spawn} from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  statfsSync,
  writeFileSync,
} from 'node:fs';
import {createServer} from 'node:net';
import {constants, homedir, hostname, setPriority} from 'node:os';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {analysisVersion, blockVersions} from '../sessions/analyze.mjs';
import {versionKey} from '../sessions/versionKey.mjs';
import {adapter, telemetryFolder} from '../sessions/sims.mjs';
import {
  beatKey,
  heartbeatDoc,
  hostIdOf,
  idleState,
  problemsOf,
} from './heartbeat.mjs';
import {stopWhenGameStarts} from './gameGuard.mjs';
import {parentGone} from './parentGuard.mjs';
import {
  isProgressLine,
  newSyncResult,
  progressOf,
  queueCount,
  readSyncLine,
} from './syncOutput.mjs';
import {createHeartbeatSender, httpSend} from './heartbeatSender.mjs';
import {earliestRetryMs, nextRetries, waitingIds} from './retries.mjs';
import {runWithBeats} from './syncBeats.mjs';
import {clearStaleSyncing, stateOf} from './watchState.mjs';
import {decide, retryDelayMin} from './trigger.mjs';
import {floorOf, OLDER_REQUEST} from '../sessions/syncState.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// LAP_SYNC_SCRIPT, LAP_HEARTBEAT_FILE, LAP_LOCK_PIPE and LAP_GAME_EXE are test
// seams (watch.e2e.test.mjs): a stand-in sync, the heartbeat docs appended to a
// file instead of Firestore, and a lock and game name of their own so a test
// never meets the real watcher or the real game.
const syncScript =
  process.env.LAP_SYNC_SCRIPT || resolve(here, '../sessions/sync.mjs');
const local = process.env.LOCALAPPDATA || homedir();
// LAP_UPLOADER_HOME: the tray app keeps its own state, apart from the logon task's.
const home = process.env.LAP_UPLOADER_HOME || resolve(local, 'lap-uploader');
const statePath = resolve(home, 'state.json');
const logPath = resolve(home, 'watch.log');
const recorderStatus = resolve(local, 'lap-capture', 'status.json');
const dash = process.argv.indexOf('--');
const syncArgs = dash < 0 ? [] : process.argv.slice(dash + 1);
// sync.mjs's work folder (the tray passes its own with --work) and its record
// of files already described.
function syncArg(name) {
  const i = syncArgs.indexOf(name);
  return i < 0 ? undefined : syncArgs[i + 1];
}
const syncWork = resolve(syncArg('--work') ?? resolve(local, 'lap-sessions'));
const firstWindowDays = Number(syncArg('--first-window-days') ?? 0);
// The sims it watches, each with its own folder and its own sync (--sim).
// LAP_SIMS narrows the list (a test seam; the default is every sim we know).
const SIMS = (process.env.LAP_SIMS || 'lmu,iracing')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean)
  .map(id => ({id, adapter: adapter(id), folder: telemetryFolder(id)}));
const gameExeOf = ({adapter: a}) =>
  (a.watcher.gameExeEnv && process.env[a.watcher.gameExeEnv]) || a.gameExe;
const LOCK_PIPE =
  process.env.LAP_LOCK_PIPE || String.raw`\\.\pipe\lap-uploader-watch`;
const TICK_SEC = 30;
const BEAT_MIN = 5;
// A running sync rewrites the heartbeat at least this often.
const KEEPALIVE_SEC = 60;
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const hostId = hostIdOf(hostname());

// Keeps the current log and one older one.
function log(line) {
  try {
    if (statSync(logPath).size > LOG_MAX_BYTES)
      renameSync(logPath, `${logPath}.1`);
  } catch {
    // No log yet.
  }
  appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

// One instance: a named pipe only one process can hold. Windows frees it
// when that process ends, so a crash or reboot never leaves a stale lock.
function takeLock() {
  return new Promise(done => {
    const server = createServer();
    server.once('error', () => done(false));
    server.listen(LOCK_PIPE, () => {
      server.unref();
      done(true);
    });
  });
}

function exeRunning(exe) {
  const out = execFileSync(
    'tasklist',
    ['/FI', `IMAGENAME eq ${exe}`, '/NH', '/FO', 'CSV'],
    {encoding: 'utf8', windowsHide: true},
  );
  return out.includes(exe);
}

// Any watched sim: a sync in the garage costs VR frames whichever game is up.
function gameRunning() {
  return SIMS.some(sim => exeRunning(gameExeOf(sim)));
}

// sync.mjs's work folder per sim: the legacy-layout sim's is the one passed in,
// so existing installs keep their record; the others get a folder of their own.
const workOf = sim =>
  sim.adapter.watcher.legacyLayout ? syncWork : resolve(syncWork, sim.id);

// Recordings, the newest change time, and how many still need a sync: changed
// since the last clean sync, or on a fresh watcher, not yet in sync.mjs's own
// state (its file list, same size and time). Counting every file on a fresh
// install made the queue read 557 for sessions long uploaded (apex #553).
function recordings(sim, sinceMs) {
  const telemetry = sim.folder;
  if (!existsSync(telemetry)) return null;
  const syncState =
    sinceMs == null ? readJson(resolve(workOf(sim), 'state.json'), null) : null;
  const known = sinceMs == null ? syncState?.files ?? {} : null;
  // Recordings older than the first-run window are not waiting for a sync.
  const floor = floorOf(syncState, {windowDays: firstWindowDays});
  const floorMs = floor ? Date.parse(floor) : null;
  let newestMtimeMs = null;
  let newer = 0;
  for (const name of readdirSync(telemetry)) {
    const path = resolve(telemetry, name);
    if (!sim.adapter.isRecording(path)) continue;
    const {mtimeMs, size} = statSync(path);
    if (newestMtimeMs == null || mtimeMs > newestMtimeMs)
      newestMtimeMs = mtimeMs;
    const seen = known?.[name];
    const pending =
      (floorMs == null || mtimeMs >= floorMs) &&
      (known
        ? !(seen && seen.size === size && seen.mtimeMs === mtimeMs)
        : mtimeMs > sinceMs);
    if (pending) newer++;
  }
  return {newestMtimeMs, newer};
}

// LAP_VERSION: set by the tray app, which is installed without git.
function version() {
  if (process.env.LAP_VERSION) return process.env.LAP_VERSION;
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: here,
      encoding: 'utf8',
      windowsHide: true,
      // Not a repository (an installed copy): no "fatal:" line on stderr.
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

// sync.mjs in a child at below-normal priority. Its output goes to the log;
// the session ids and the closing "done N, failed M" line feed the heartbeat.
// sync.mjs skips files written in the last 3 minutes in case the game is
// still writing them; the game is closed here, so nothing is.
function syncArgsOf(sim) {
  const {quietMin, legacyLayout} = sim.adapter.watcher;
  const args = [...syncArgs];
  if (!legacyLayout) {
    const i = args.indexOf('--work');
    if (i < 0) args.push('--work', workOf(sim));
    else args[i + 1] = workOf(sim);
  }
  return [
    ...(quietMin == null ? [] : ['--quiet-min', String(quietMin)]),
    ...args,
    '--sim',
    sim.id,
  ];
}

function runSync(sim, onProgress, skipIds) {
  return new Promise(done => {
    const args = [syncScript, ...syncArgsOf(sim)];
    if (skipIds.length) args.push('--skip', skipIds.join(','));
    const child = spawn(process.execPath, args, {windowsHide: true});
    try {
      setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // Priority is a courtesy; the sync still runs.
    }
    const result = newSyncResult();
    let buffer = '';
    const onData = chunk => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        log(`  sync | ${line}`);
        readSyncLine(result, line);
        if (isProgressLine(line)) onProgress(progressOf(result));
      }
    };
    child.stdout.setEncoding('utf8').on('data', onData);
    child.stderr.setEncoding('utf8').on('data', onData);
    // The whole tree: the sync and the DuckDB processes it runs.
    const guard = stopWhenGameStarts(child, {
      gameRunning,
      kill: pid =>
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
        }),
    });
    child.on('close', code => {
      guard.cancel();
      done({...result, code, stoppedForGame: guard.stopped()});
    });
  });
}

// The earliest of several retry times, null when none is pending.
function earliestOf(times) {
  const set = times.filter(t => t != null);
  return set.length ? Math.min(...set) : null;
}

let db = null;
// Under the tray app (a token file) the status also goes to the server, which
// stores it under the signed-in user's owner key (heartbeatSender.mjs). Not
// awaited: a slow or refused request never holds up a sync.
const statusSender = process.env.LAP_TOKEN_FILE
  ? createHeartbeatSender({
      send: httpSend({
        api: process.env.LAP_API || undefined,
        tokenFile: process.env.LAP_TOKEN_FILE,
      }),
      log: line => log(line),
    })
  : null;
async function writeBeat(doc) {
  if (process.env.LAP_HEARTBEAT_FILE) {
    appendFileSync(process.env.LAP_HEARTBEAT_FILE, `${JSON.stringify(doc)}\n`);
    void statusSender?.offer(doc);
    return;
  }
  if (!db) db = (await import('../sessions/store.mjs')).connect().db;
  await db.collection('uploaders').doc(hostId).set(doc);
}

async function main() {
  mkdirSync(home, {recursive: true});
  if (!(await takeLock())) return;
  const once = process.argv.includes('--once');
  const ver = version();
  const {label = 'Race PC'} = readJson(resolve(home, 'config.json'), {});
  const watch = readJson(statePath, {});
  // State from before block versions kept only analysisVersion: no versionKey
  // reads as changed, so the first run with this code syncs everything once.
  const currentKey = versionKey(analysisVersion, blockVersions);
  // Failed sessions and their backoff (retries.mjs); older state had a list.
  watch.retries ??= {};
  delete watch.failedSessions;
  clearStaleSyncing(watch, SIMS);
  // Written to a temp file and renamed, so the tray never reads a half-written state.json.
  const save = () => {
    const tmp = `${statePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(watch));
    renameSync(tmp, statePath);
  };
  save();
  let wasRunning = false;
  let lastKey = '';
  let lastBeatMs = 0;
  let progress = null;
  log(
    `start ${hostId} ${ver}, telemetry ${SIMS.map(
      s => `${s.id} ${s.folder}`,
    ).join(', ')}`,
  );

  // force: write even when nothing changed, so lastSeenAt stays fresh through a
  // long step that prints no progress (a surface fold, one big session).
  const beat = async (state, force = false) => {
    const all = SIMS.map(sim => {
      const st = stateOf(watch, sim);
      return {sim, st, recs: recordings(sim, st.lastRunAtMs)};
    });
    const lmuRecs =
      all.find(a => a.sim.adapter.watcher.legacyLayout)?.recs ?? null;
    const retryIds = all.flatMap(a => Object.keys(a.st.retries ?? {}));
    let freeBytes = null;
    try {
      const fs = statfsSync(local);
      freeBytes = fs.bavail * fs.bsize;
    } catch {
      // Unknown free space is shown as unknown.
    }
    const recorder = readJson(recorderStatus, null);
    const nowMs = Date.now();
    const doc = heartbeatDoc({
      hostId,
      label,
      version: ver,
      lmuFound: lmuRecs != null,
      state,
      // Totals are shared; the error shown is the first any sim has.
      watch: {
        ...watch,
        lastError: all.map(a => a.st.lastError).find(Boolean) ?? null,
      },
      progress,
      queue: queueCount({
        pendingFiles: all.reduce((n, a) => n + (a.recs?.newer ?? 0), 0),
        failedSessions: retryIds,
      }),
      freeBytes,
      recorder,
      retryAtMs: earliestOf(all.map(a => earliestRetryMs(a.st.retries ?? {}))),
      problems: problemsOf({sims: all.map(a => a.st), recorder, nowMs}),
      nowMs,
    });
    const key = beatKey(doc);
    if (
      !force &&
      key === lastKey &&
      Date.now() - lastBeatMs < BEAT_MIN * 60 * 1000
    )
      return;
    try {
      await writeBeat(doc);
      lastKey = key;
      lastBeatMs = Date.now();
    } catch (error) {
      // Offline or no credentials: keep syncing, try again next tick.
      log(`heartbeat failed: ${String(error.message || error)}`);
    }
  };

  tick: for (;;) {
    if (parentGone()) {
      log('the tray app is gone, stopping');
      process.exit(0); // the lock pipe would keep the process alive otherwise
    }
    try {
      const running = gameRunning();
      for (const sim of SIMS) {
        const st = stateOf(watch, sim);
        const recs = recordings(sim, st.lastRunAtMs);
        const plan = decide({
          gameRunning: running,
          wasRunning,
          newestMtimeMs: recs?.newestMtimeMs ?? null,
          lastRunAtMs: st.lastRunAtMs ?? null,
          retryAtMs: st.retryAtMs ?? null,
          sessionRetryAtMs: earliestRetryMs(st.retries),
          // First run with this code, or a merge that bumped it.
          versionChanged: st.versionKey !== currentKey,
          olderRequested: existsSync(resolve(workOf(sim), OLDER_REQUEST)),
          nowMs: Date.now(),
        });
        if (plan.run) {
          log(
            `sync${sim.adapter.watcher.legacyLayout ? '' : ` ${sim.id}`}: ${
              plan.reason
            }`,
          );
          const startedMs = Date.now();
          const skippedIds = waitingIds(st.retries, startedMs);
          await beat('syncing');
          // Beats while the sync runs: one per progress line, and every minute
          // with or without one (a surface fold of a dozen tracks printed none
          // for 15 minutes and the heartbeat went stale). They are stopped, and
          // any write in flight awaited, before the state that follows is
          // written, even if the sync throws (syncBeats.mjs).
          // The prune (tray, Rust) reads this flag and deletes nothing while a
          // sync runs. Cleared in a finally, so a throw cannot leave it set.
          st.syncing = true;
          save();
          let r;
          try {
            r = await runWithBeats(
              {beat, intervalMs: KEEPALIVE_SEC * 1000, log},
              beatProgress =>
                runSync(
                  sim,
                  p => {
                    progress = p;
                    // One write in flight at a time; the next block catches up.
                    beatProgress();
                  },
                  skippedIds,
                ),
            );
          } finally {
            st.syncing = false;
            save();
          }
          progress = null;
          // A stopped sync never prints its closing "done N" line, but each
          // session's block is printed only once it is stored or has failed.
          // A fold block (sync's pass before the sessions) stores nothing: only
          // the others are uploads.
          if (r.stoppedForGame) r.done = r.stored.length - r.failedIds.length;
          if (r.done) {
            watch.lastUploadAt = new Date().toISOString();
            watch.lastSessionId = r.stored[0] ?? watch.lastSessionId;
            watch.sessionsDone = (watch.sessionsDone ?? 0) + r.done;
          }
          if (r.stoppedForGame) {
            // Not a failure: nothing to retry or report. The trigger still
            // holds (new telemetry, new version), so it runs again once LMU
            // exits, and redoes only what this pass had not stored.
            save();
            log(`sync: stopped, LMU started (done ${r.done} before the stop)`);
            wasRunning = true;
            await beat('in-game');
            continue tick;
          }
          // Each failed session waits on its own backoff and is skipped until
          // then; everything else is done, so the run and the version count as
          // done. sync.mjs exits 1 on any failed session, so only its closing
          // line tells a finished pass from a crash: a sync that died part way
          // (even after a failed block) leaves sessions unreached, so it waits
          // as a whole and records neither run time nor version.
          if (!r.finished) {
            st.failuresInRow = (st.failuresInRow ?? 0) + 1;
            st.retryAtMs =
              Date.now() + retryDelayMin(st.failuresInRow) * 60 * 1000;
            // Shown in the app as the uploader's error: what died, and when.
            const why =
              r.crash ?? r.errors[0] ?? `sync exited with code ${r.code}`;
            st.lastError = {
              at: new Date().toISOString(),
              message: `sync crashed: ${why}`,
              path: 'lap-uploader/watch.log',
            };
            log(`sync: CRASHED, ${why}`);
          } else {
            st.retries = nextRetries({
              retries: st.retries,
              failedIds: r.failedIds,
              skippedIds,
              messages: r.failureOf,
              nowMs: Date.now(),
            });
            st.lastRunAtMs = startedMs;
            st.versionKey = currentKey;
            st.retryAtMs = null;
            st.failuresInRow = 0;
            st.lastError = r.failedIds.length
              ? {
                  at: new Date().toISOString(),
                  message: r.errors[0],
                  path: 'lap-uploader/watch.log',
                }
              : null;
          }
          save();
          log(`sync: done ${r.done}, failed ${r.failed}, exit ${r.code}`);
        }
      }
      wasRunning = running;
      await beat(
        idleState({
          crashed: SIMS.some(sim => stateOf(watch, sim).retryAtMs != null),
          gameRunning: running,
          retryPending: SIMS.some(
            sim => earliestRetryMs(stateOf(watch, sim).retries) != null,
          ),
        }),
      );
    } catch (error) {
      log(`tick failed: ${String(error.stack || error)}`);
    }
    if (once) return;
    await new Promise(wake => setTimeout(wake, TICK_SEC * 1000));
  }
}

await main();
