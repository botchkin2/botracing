// Finding a sim's recordings and grouping them into sessions: the part of
// sync.mjs that decides what a "session" is and what its id is. It lives here so
// the uploader and the curator's loader (tools/curate) find the same sessions
// with the same ids: an id is a hash of the owner key and these rules.
import {existsSync, readdirSync, statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {reusableInfo} from './describeCache.mjs';

// Recordings of one session that are further apart than this start a new one.
export const SESSION_GAP_H = 6;
const RESTART_MAX_SEC = 5 * 60;
const RESTART_GAP_SEC = 2 * 60;
// Shorter recordings hold no lap: a menu, a reset, a false start. Skip them.
export const MIN_RECORDING_SEC = 30;

/** sha1 of the parts joined by '|', first 16 hex: every id in the store. */
export function hash(...parts) {
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}

/**
 * Describe every recording in a folder, reusing earlier results for files that
 * have not changed (state.files is the cache, updated in place).
 *   adapter  the sim's adapter (isRecording, describe, describeVersion)
 *   only     keep file names containing this
 *   since    keep recordings from this day on (YYYY-MM-DD)
 *   quietMin skip files written in the last N minutes (the game may still be
 *            writing them)
 * Returns [{path, size, info}].
 */
export function scanFolder({
  folder,
  adapter,
  state,
  only = '',
  since = '',
  quietMin = 3,
  log = () => {},
}) {
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
    // A cached result is reused only for an unchanged file described by this
    // version of describe(); otherwise the file is described again.
    let info = reusableInfo(known, stat, adapter.describeVersion);
    if (!info) {
      try {
        info = adapter.describe(path);
      } catch (error) {
        log(`skip ${name}: ${String(error.message).split('\n')[0]}`);
        continue;
      }
      state.files[name] = {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        describeVersion: adapter.describeVersion,
        info,
      };
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
export function sameSession(prev, next) {
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

/**
 * Groups scanned files into sessions, oldest first. Each session is
 * {key, id, files: [{path, size, info, id}]}: the session's id is
 * hash(key, first recording's time), a recording's id
 * hash(owner, sim, source, recordedAt). The caller adds whatever else it
 * needs (sync.mjs adds a fingerprint).
 */
export function groupFiles(files, ownerId) {
  const byKey = new Map();
  for (const file of [...files].sort((a, b) =>
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
