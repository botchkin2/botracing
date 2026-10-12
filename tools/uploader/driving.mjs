// Whether the car is in LMU's garage or menus, so the drives already finished
// can upload while the game is open (Botkin, pit-wall thread 1 #4648, #4671).
//
// One rule, from the game itself: its trace log (UserData\Log, the newest
// trace*.txt, written as the game runs) has a line for every session state
// change, "Changing session state from X to Y". LMU finishes a drive's .duckdb
// within a second of DRIVING -> MONITOR_MENU (2 Oct log against file times,
// #4636), so in the garage or the menus every drive is a finished file.
//
// iRacing has no such log, so with iRacing open nothing syncs, as before.
import {closeSync, openSync, readSync, readdirSync, statSync} from 'node:fs';
import {resolve} from 'node:path';

/** The garage monitor and the menus. Every other state is a drive. */
export const GARAGE_STATES = new Set(['MONITOR_MENU', 'DISABLED']);

const STATE = /Changing session state from [A-Z_]+ to ([A-Z_]+)/g;

/** The last session state in a trace log's text, or null when it has none. */
export function lastState(text) {
  let state = null;
  for (const m of text.matchAll(STATE)) state = m[1];
  return state;
}

/** In the garage or the menus. An unknown state is not. */
export function inGarage(state) {
  return state != null && GARAGE_STATES.has(state);
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
