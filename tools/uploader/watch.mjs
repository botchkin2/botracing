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
import {analysisVersion} from '../sessions/analyze.mjs';
import * as lmu from '../sessions/lmu.mjs';
import {beatKey, heartbeatDoc, hostIdOf} from './heartbeat.mjs';
import {stopWhenGameStarts} from './gameGuard.mjs';
import {newSyncResult, queueCount, readSyncLine} from './syncOutput.mjs';
import {decide, retryDelayMin} from './trigger.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const syncScript = resolve(here, '../sessions/sync.mjs');
const local = process.env.LOCALAPPDATA || homedir();
const home = resolve(local, 'lap-uploader');
const statePath = resolve(home, 'state.json');
const logPath = resolve(home, 'watch.log');
const recorderStatus = resolve(local, 'lap-capture', 'status.json');
// sync.mjs's default work folder and its record of files already described.
const syncStatePath = resolve(local, 'lap-sessions', 'state.json');
const telemetry = process.env.LMU_TELEMETRY || lmu.defaultFolder;
const GAME_EXE = 'Le Mans Ultimate.exe';
const LOCK_PIPE = String.raw`\\.\pipe\lap-uploader-watch`;
const TICK_SEC = 30;
const BEAT_MIN = 5;
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const hostId = hostIdOf(hostname());
const dash = process.argv.indexOf('--');
const syncArgs = dash < 0 ? [] : process.argv.slice(dash + 1);

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

function gameRunning() {
  const out = execFileSync(
    'tasklist',
    ['/FI', `IMAGENAME eq ${GAME_EXE}`, '/NH', '/FO', 'CSV'],
    {encoding: 'utf8', windowsHide: true},
  );
  return out.includes(GAME_EXE);
}

// Recordings, the newest change time, and how many still need a sync: changed
// since the last clean sync, or on a fresh watcher, not yet in sync.mjs's own
// state (its file list, same size and time). Counting every file on a fresh
// install made the queue read 557 for sessions long uploaded (apex #553).
function recordings(sinceMs) {
  if (!existsSync(telemetry)) return null;
  const known =
    sinceMs == null ? readJson(syncStatePath, {}).files ?? {} : null;
  let newestMtimeMs = null;
  let newer = 0;
  for (const name of readdirSync(telemetry)) {
    const path = resolve(telemetry, name);
    if (!lmu.isRecording(path)) continue;
    const {mtimeMs, size} = statSync(path);
    if (newestMtimeMs == null || mtimeMs > newestMtimeMs)
      newestMtimeMs = mtimeMs;
    const seen = known?.[name];
    const pending = known
      ? !(seen && seen.size === size && seen.mtimeMs === mtimeMs)
      : mtimeMs > sinceMs;
    if (pending) newer++;
  }
  return {newestMtimeMs, newer};
}

function version() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: here,
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
  } catch {
    return 'unknown';
  }
}

// sync.mjs in a child at below-normal priority. Its output goes to the log;
// the session ids and the closing "done N, failed M" line feed the heartbeat.
// sync.mjs skips files written in the last 3 minutes in case the game is
// still writing them; the game is closed here, so nothing is.
function runSync() {
  return new Promise(done => {
    const args = [syncScript, '--quiet-min', '0', ...syncArgs];
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

let db = null;
async function writeBeat(doc) {
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
  const save = () => writeFileSync(statePath, JSON.stringify(watch));
  let wasRunning = false;
  let lastKey = '';
  let lastBeatMs = 0;
  log(`start ${hostId} ${ver}, telemetry ${telemetry}`);

  const beat = async state => {
    const recs = recordings(watch.lastRunAtMs);
    let freeBytes = null;
    try {
      const fs = statfsSync(local);
      freeBytes = fs.bavail * fs.bsize;
    } catch {
      // Unknown free space is shown as unknown.
    }
    const doc = heartbeatDoc({
      hostId,
      label,
      version: ver,
      lmuFound: recs != null,
      state,
      watch,
      queue: queueCount({
        pendingFiles: recs?.newer ?? 0,
        failedSessions: watch.failedSessions,
      }),
      freeBytes,
      recorder: readJson(recorderStatus, null),
      nowMs: Date.now(),
    });
    const key = beatKey(doc);
    if (key === lastKey && Date.now() - lastBeatMs < BEAT_MIN * 60 * 1000)
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

  for (;;) {
    try {
      const running = gameRunning();
      const recs = recordings(watch.lastRunAtMs);
      const plan = decide({
        gameRunning: running,
        wasRunning,
        newestMtimeMs: recs?.newestMtimeMs ?? null,
        lastRunAtMs: watch.lastRunAtMs ?? null,
        retryAtMs: watch.retryAtMs ?? null,
        // First run with this code, or a merge that bumped it.
        versionChanged: watch.analysisVersion !== analysisVersion,
        nowMs: Date.now(),
      });
      wasRunning = running;
      if (plan.run) {
        log(`sync: ${plan.reason}`);
        const startedMs = Date.now();
        await beat('syncing');
        const r = await runSync();
        if (r.stoppedForGame) {
          // Not a failure: nothing to retry or report. The trigger still
          // holds (new telemetry, new version), so it runs again once LMU
          // exits, and redoes only what this pass had not stored.
          log(`sync: stopped, LMU started (done ${r.done} before the stop)`);
          wasRunning = true;
          await beat('in-game');
          continue;
        }
        if (r.done) {
          watch.lastUploadAt = new Date().toISOString();
          watch.lastSessionId = r.sessions[0] ?? watch.lastSessionId;
          watch.sessionsDone = (watch.sessionsDone ?? 0) + r.done;
        }
        // A failed session is retried later. sync.mjs redoes only what is not
        // stored yet, so a retry costs just the failures.
        // Every sync retries all failures, so this pass's list replaces the last.
        watch.failedSessions = r.failedIds;
        if (r.failed || r.code) {
          watch.failuresInRow = (watch.failuresInRow ?? 0) + 1;
          watch.retryAtMs =
            Date.now() + retryDelayMin(watch.failuresInRow) * 60 * 1000;
          watch.lastError = {
            at: new Date().toISOString(),
            message: r.errors[0] ?? `sync exited with code ${r.code}`,
            path: 'lap-uploader/watch.log',
          };
        } else {
          watch.lastRunAtMs = startedMs;
          watch.analysisVersion = analysisVersion;
          watch.retryAtMs = null;
          watch.failuresInRow = 0;
          watch.lastError = null;
        }
        save();
        log(`sync: done ${r.done}, failed ${r.failed}, exit ${r.code}`);
      }
      await beat(
        watch.lastError ? 'error' : running ? 'in-game' : 'waiting-for-game',
      );
    } catch (error) {
      log(`tick failed: ${String(error.stack || error)}`);
    }
    if (once) return;
    await new Promise(wake => setTimeout(wake, TICK_SEC * 1000));
  }
}

await main();
