// A safety copy of one LMU replay, taken only when that capture's recorder
// logged a loss (pit-wall thread 100 #6847, #6849, #6895). The game's file is
// never deleted. Our copy goes once the capture is verified with its field,
// or at 30 days. A size cap never deletes an unverified copy.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {isAbsolute, relative, resolve} from 'node:path';

// Apex #6847: a cap, named there as 20 GB, and 30 days.
export const REPLAY_CAP_BYTES = 20 * 1024 ** 3;
export const REPLAY_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
// "Near" was not given a number. 1 GB is one more race replay (those run
// 200–400 MB, #6847) short of the cap.
export const REPLAY_NEAR_BYTES = 1024 ** 3;
// Two stats this far apart. A replay's mtime keeps moving while the game
// writes it (measured on this PC: every file, for the length of the session,
// and none later than two hours).
export const SETTLE_MS = 2000;
// A failed copy is tried this many times, then a Problems line, and not again
// (steward #7181). A hardlink is not used: an in-place rewrite would change it.
export const COPY_TRIES = 3;
export const COPY_FAIL_MESSAGE = 'Could not copy the replay';
// How long after the capture closes the game may still be writing the replay.
// The same 30 min as the results file (lmuResults.mjs WRITE_WINDOW_MS).
export const REPLAY_LOOK_MS = 30 * 60 * 1000;
export const DEFAULT_REPLAY_FOLDER =
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Le Mans Ultimate\\UserData\\Replays';

const LOSS_KEYS = [
  'writeFailures',
  'lostChunks',
  'lostPlayerRows',
  'lostSessionRows',
  'lostFieldRows',
  'gaps',
];

const countOf = value => (typeof value === 'number' && value > 0 ? value : 0);
const textOf = value => (typeof value === 'string' && value.trim() ? value : '');

/**
 * True when this capture's own meta counted a loss, or recorder.log has a
 * "recorder stopped" line inside [sinceMs, untilMs]. iRacing's lines are
 * prefixed "iracing:" and are not this copy. A line with no time does not count.
 */
export function recorderLoggedProblem({meta, logText, sinceMs, untilMs}) {
  if (LOSS_KEYS.some(key => countOf(meta?.[key]) > 0)) return true;
  if (textOf(meta?.lastWriteError)) return true;
  return logStoppedInWindow(logText, sinceMs, untilMs);
}

export function logStoppedInWindow(logText, sinceMs, untilMs) {
  if (!logText || !Number.isFinite(sinceMs)) return false;
  const until = Number.isFinite(untilMs) ? untilMs : Infinity;
  for (const line of String(logText).split('\n')) {
    if (line.includes('iracing:')) continue;
    if (!line.includes('recorder stopped')) continue;
    const at = Date.parse(line.slice(0, 20));
    if (Number.isNaN(at) || at < sinceMs || at > until) continue;
    return true;
  }
  return false;
}

const isTempName = name => {
  const lower = name.toLowerCase();
  return lower.endsWith('.tmp') || lower.startsWith('_');
};

/** The newest non-temp replay written during the capture, or null. */
export function chooseReplay(files, {fromMs, toMs}) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  const end = toMs + REPLAY_LOOK_MS;
  let best = null;
  for (const file of files) {
    if (!file || file.temp || isTempName(file.name ?? '')) continue;
    if (!(file.mtimeMs >= fromMs && file.mtimeMs <= end)) continue;
    if (!best || file.mtimeMs > best.mtimeMs) best = file;
  }
  return best;
}

/**
 * Always a real copy once the file has stopped changing (steward #7181).
 * A file still moving waits. A temp name is not copied.
 */
export function linkKind({tempFile, settled}) {
  if (tempFile) return 'skip';
  if (!settled) return 'wait';
  return 'copy';
}

export function fileSettled(before, after) {
  return Boolean(
    before &&
      after &&
      before.size > 0 &&
      before.size === after.size &&
      before.mtimeMs === after.mtimeMs,
  );
}

/**
 * What to do with the copies we already hold.
 * `verified` copies are removed (the capture was read back with its field).
 * Unverified copies older than the keep window are removed.
 * The cap never removes an unverified copy. Over the cap, or within
 * REPLAY_NEAR_BYTES of it, is a Problems line.
 */
export function planCopies(copies, nowMs, limits = {}) {
  const capBytes = limits.capBytes ?? REPLAY_CAP_BYTES;
  const keepMs = limits.keepMs ?? REPLAY_KEEP_MS;
  const nearBytes = limits.nearBytes ?? REPLAY_NEAR_BYTES;
  const remove = [];
  const keep = [];
  for (const copy of copies) {
    if (copy.verified) remove.push({id: copy.id, reason: 'verified'});
    else if (nowMs - copy.takenMs > keepMs) remove.push({id: copy.id, reason: 'age'});
    else keep.push(copy);
  }
  const bytes = keep.reduce((sum, copy) => sum + (copy.bytes || 0), 0);
  const gb = Math.max(1, Math.round(capBytes / 1024 ** 3));
  let problem = null;
  if (bytes > capBytes)
    problem = `Replay copies are over ${gb} GB; unverified ones are kept`;
  else if (bytes > 0 && capBytes - bytes < nearBytes)
    problem = `Replay copies are close to their ${gb} GB cap`;
  return {remove, keep, bytes, problem};
}

function inside(root, target) {
  const rel = relative(root, resolve(target));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function captureVerified(file) {
  const doc = readJson(file);
  const ids = Array.isArray(doc?.sessionIds) ? doc.sessionIds.filter(Boolean) : [];
  if (ids.length === 0) return false;
  return ids.every(id => textOf(doc.verified?.[id]?.fieldHash));
}

function listReplayFiles(folder) {
  if (!existsSync(folder)) return [];
  const out = [];
  for (const name of readdirSync(folder)) {
    let st;
    try {
      st = statSync(resolve(folder, name));
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    out.push({
      name,
      mtimeMs: st.mtimeMs,
      size: st.size,
      temp: isTempName(name),
    });
  }
  return out;
}

function readCopies(replaysRoot, captureRoot) {
  if (!existsSync(replaysRoot)) return [];
  const out = [];
  for (const id of readdirSync(replaysRoot)) {
    const marker = resolve(replaysRoot, id, 'copy.json');
    if (!existsSync(marker)) continue;
    const doc = readJson(marker);
    if (!doc || typeof doc.takenMs !== 'number') continue;
    out.push({
      id,
      bytes: typeof doc.bytes === 'number' ? doc.bytes : 0,
      takenMs: doc.takenMs,
      verified: captureVerified(resolve(captureRoot, id, 'uploaded.json')),
    });
  }
  return out;
}

function readTries(dir) {
  const doc = readJson(resolve(dir, 'attempts.json'));
  return typeof doc?.tries === 'number' ? doc.tries : 0;
}

function writeTries(dir, tries) {
  mkdirSync(dir, {recursive: true});
  writeFileSync(resolve(dir, 'attempts.json'), JSON.stringify({tries}));
}

/** A capture that already used its tries and never got a copy. The watcher
 *  clears its hold, so the line has to come from this file on later ticks. */
function failedCopy(replaysRoot) {
  if (!existsSync(replaysRoot)) return false;
  for (const id of readdirSync(replaysRoot)) {
    const dir = resolve(replaysRoot, id);
    if (!inside(replaysRoot, dir)) continue;
    if (existsSync(resolve(dir, 'copy.json'))) continue;
    if (readTries(dir) >= COPY_TRIES) return true;
  }
  return false;
}

/**
 * One watcher tick. Removes copies the plan names, and when `closedDir` had a
 * recorder problem, copies that session's replay under `replaysRoot/<capture>/`.
 * Returns the capture still waiting on a file the game is writing, and the
 * Problems line (a failed copy, else the cap), or null.
 */
export async function maintainReplayCopies({
  captureRoot,
  replaysRoot,
  replayFolder,
  closedDir = null,
  holdSinceMs = null,
  nowMs,
  gameRunning,
  log = () => {},
  settleMs = SETTLE_MS,
  wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms)),
  copyFile = copyFileSync,
  limits,
} = {}) {
  mkdirSync(replaysRoot, {recursive: true});
  const apply = copies => {
    const plan = planCopies(copies, nowMs, limits);
    for (const item of plan.remove) {
      const dir = resolve(replaysRoot, item.id);
      if (!inside(replaysRoot, dir)) continue;
      rmSync(dir, {recursive: true, force: true});
      log(`replay copy removed (${item.reason}): ${item.id}`);
    }
    return plan;
  };
  apply(readCopies(replaysRoot, captureRoot));

  let hold = null;
  let failProblem = null;
  const marker = closedDir ? resolve(replaysRoot, closedDir, 'copy.json') : null;
  const destDir = closedDir ? resolve(replaysRoot, closedDir) : null;
  const tries = destDir && inside(replaysRoot, destDir) ? readTries(destDir) : 0;
  if (closedDir && tries >= COPY_TRIES) failProblem = COPY_FAIL_MESSAGE;
  if (closedDir && !existsSync(marker)) {
    const captureDir = resolve(captureRoot, closedDir);
    const meta = readJson(resolve(captureDir, 'meta.json'));
    let born = null;
    try {
      born = statSync(captureDir).birthtimeMs;
    } catch {
      born = null;
    }
    const logText = existsSync(resolve(captureRoot, 'recorder.log'))
      ? readFileSync(resolve(captureRoot, 'recorder.log'), 'utf8')
      : '';
    const logged = recorderLoggedProblem({
      meta,
      logText,
      sinceMs: born,
      untilMs: nowMs,
    });
    if (!failProblem && logged && Number.isFinite(born)) {
      const chosen = chooseReplay(listReplayFiles(replayFolder), {
        fromMs: born,
        toMs: nowMs,
      });
      const since = holdSinceMs ?? nowMs;
      if (!chosen) {
        if (nowMs - since < REPLAY_LOOK_MS) hold = closedDir;
        else log(`replay copy: no replay for ${closedDir}`);
      } else {
        const src = resolve(replayFolder, chosen.name);
        const first = statSync(src);
        let settled = !gameRunning && first.size > 0;
        if (gameRunning) {
          if (settleMs > 0) await wait(settleMs);
          settled = fileSettled(first, statSync(src));
        }
        const kind = linkKind({tempFile: chosen.temp, settled});
        if (kind === 'wait') {
          if (nowMs - since >= REPLAY_LOOK_MS) failProblem = COPY_FAIL_MESSAGE;
          else hold = closedDir;
        } else if (kind !== 'skip') {
          if (!inside(replaysRoot, destDir))
            log(`replay copy: refused a path outside the copy folder`);
          else {
            mkdirSync(destDir, {recursive: true});
            const dest = resolve(destDir, chosen.name);
            try {
              copyFile(src, dest);
              const bytes = statSync(dest).size;
              writeFileSync(
                resolve(destDir, 'copy.json'),
                JSON.stringify({
                  v: 1,
                  capture: closedDir,
                  file: chosen.name,
                  bytes,
                  takenMs: nowMs,
                }),
              );
              log(`replay copy: ${closedDir}`);
            } catch (error) {
              const n = tries + 1;
              writeTries(destDir, n);
              if (n >= COPY_TRIES) failProblem = COPY_FAIL_MESSAGE;
              else hold = closedDir;
              log(`replay copy failed (${n}): ${error?.message ?? error}`);
            }
          }
        }
      }
    }
  }

  const after = planCopies(readCopies(replaysRoot, captureRoot), nowMs, limits);
  const message = failProblem || (failedCopy(replaysRoot) ? COPY_FAIL_MESSAGE : null) || after.problem;
  return {
    hold: failProblem ? null : hold,
    problem: message ? {message, atMs: nowMs} : null,
  };
}
