// Whether the car is in LMU's garage, so the finished drives can upload while
// the game is open (Botkin, pit-wall thread 1 #4648 to #4669).
//
// The game says so itself: its trace log (UserData\Log, the newest trace*.txt,
// written as the game runs) has a line for every session state change,
// "Changing session state from X to Y". On the 2 Oct log every drive's
// .duckdb appears within 2 s of MONITOR_MENU -> DRIVING and is finished within
// 1 s of DRIVING -> MONITOR_MENU (#4636). So the state is the signal, and the
// telemetry folder is a second one: nothing may have been written there in the
// last DRIVING_WINDOW_MS. Both must say "not driving".
//
// iRacing has no such log, and nothing proves how often an .ibt is written
// mid-drive (in the pit box it keeps growing), so with iRacing open nothing
// syncs, as before.
import {closeSync, openSync, readSync, readdirSync, statSync} from 'node:fs';
import {resolve} from 'node:path';

/** No telemetry file may have been written this recently. */
export const DRIVING_WINDOW_MS = 60_000;

/**
 * The states the car is off track in: the garage monitor and the menus. Every
 * other one (DRIVING, PAUSED on track, PAUSED_AI_IN_PIT, END_OF_RACE_GRACE,
 * LOADING) is treated as a drive. From every transition in his logs.
 */
export const GARAGE_STATES = new Set(['MONITOR_MENU', 'DISABLED']);

const STATE = /Changing session state from [A-Z_]+ to ([A-Z_]+)/g;

/** The last session state in a trace log's text, or null when it has none. */
export function lastState(text) {
  let state = null;
  for (const m of text.matchAll(STATE)) state = m[1];
  return state;
}

/**
 * `files`: [{name, mtimeMs}] of a telemetry folder. True when any of them,
 * the recording or its WAL, was written in the last DRIVING_WINDOW_MS.
 */
export function recentlyWritten(files, nowMs, windowMs = DRIVING_WINDOW_MS) {
  return files.some(f => nowMs - f.mtimeMs < windowMs);
}

/** In the garage: the game's state says so and nothing is being written. */
export function inGarage({state, files, nowMs}) {
  return (
    state != null && GARAGE_STATES.has(state) && !recentlyWritten(files, nowMs)
  );
}

const TAIL_BYTES = 256 * 1024;

/** The state the newest trace log ends in; null without a readable log. */
export function lmuState(logFolder) {
  let newest = null;
  try {
    for (const name of readdirSync(logFolder)) {
      if (!/^trace.*\.txt$/.test(name)) continue;
      const path = resolve(logFolder, name);
      const {mtimeMs, size} = statSync(path);
      if (!newest || mtimeMs > newest.mtimeMs) newest = {path, mtimeMs, size};
    }
    if (!newest) return null;
    const length = Math.min(TAIL_BYTES, newest.size);
    const buffer = Buffer.alloc(length);
    const fd = openSync(newest.path, 'r');
    try {
      readSync(fd, buffer, 0, length, newest.size - length);
    } finally {
      closeSync(fd);
    }
    return lastState(buffer.toString('utf8'));
  } catch {
    return null;
  }
}
