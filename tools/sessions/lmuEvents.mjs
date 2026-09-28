// Online events joined in LMU, read from the game's trace logs.
//
// The recording itself says nothing about which online event it was. The
// trace log does, one line per server join:
//   650.98s RestNavigati  577: "UI info: Joining practice server for online
//   event 5fcde786-da98-491a-bb48-126f411cfc55 - ELMS Super 60 with car ..."
// The GUID is the official event id (it matches RaceControl's event ids, see
// pit-wall thread 23). A join lasts until the game goes back to the main menu,
// the next join, or the end of that log (game closed or crashed).
//
// LMU keeps only a few weeks of trace logs, so every window seen is merged
// into a cache in the work folder and matched from there.
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

export const defaultLogFolder =
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Le Mans Ultimate\\UserData\\Log';

const JOIN =
  /^\s*([\d.]+)s .*Joining (race|practice) server for online event ([0-9a-f-]{36}) - (.+) with car (\S+?)"?\s*$/;
const LEAVE = /^\s*([\d.]+)s .*Executing NAV_TO_MAIN_MENU/;
const OFFSET = /^\s*([\d.]+)s /;
const LOG_NAME =
  /^trace_(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})-\d+\.txt$/;

// The log name is the game's start time in the PC's local time zone. The
// uploader runs on the PC that wrote the logs, so the local zone is the right
// one to read it in. The hour repeated when daylight saving ends is ambiguous;
// a log started in it can be off by an hour, once a year.
export function logStart(name) {
  const m = name.match(LOG_NAME);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

// Join windows in one log's text. startMs is the log's start time.
export function parseLog(text, startMs, source) {
  const windows = [];
  let open = null;
  let lastS = 0;
  const close = endS => {
    if (!open) return;
    windows.push({...open, endedAt: iso(startMs, endS)});
    open = null;
  };
  for (const line of text.split(/\r?\n/)) {
    const at = line.match(OFFSET);
    if (at) lastS = Number(at[1]);
    const join = line.match(JOIN);
    if (join) {
      close(Number(join[1]));
      open = {
        eventId: join[3],
        series: join[4].trim(),
        kind: join[2],
        car: join[5],
        joinedAt: iso(startMs, Number(join[1])),
        source,
      };
      continue;
    }
    const leave = line.match(LEAVE);
    if (leave) close(Number(leave[1]));
  }
  close(lastS);
  return windows;
}

function iso(startMs, offsetS) {
  return new Date(startMs + Math.round(offsetS * 1000)).toISOString();
}

// Every join window in the log folder, merged with the ones cached from
// earlier runs. The cache is rewritten with the union.
export function readEventWindows({
  logFolder = defaultLogFolder,
  cachePath,
} = {}) {
  const byKey = new Map();
  const keep = w => byKey.set(`${w.source}|${w.joinedAt}`, w);
  if (cachePath && existsSync(cachePath)) {
    for (const w of JSON.parse(readFileSync(cachePath, 'utf8'))) keep(w);
  }
  if (existsSync(logFolder)) {
    for (const name of readdirSync(logFolder)) {
      const startMs = logStart(name);
      if (startMs == null) continue;
      const text = readFileSync(resolve(logFolder, name), 'latin1');
      for (const w of parseLog(text, startMs, name)) keep(w);
    }
  }
  const windows = [...byKey.values()].sort((a, b) =>
    a.joinedAt.localeCompare(b.joinedAt),
  );
  if (cachePath) writeFileSync(cachePath, JSON.stringify(windows, null, 1));
  return windows;
}

// The join window a recording started in, or null for offline running.
export function eventFor(windows, recordedAt) {
  const t = Date.parse(recordedAt);
  let match = null;
  for (const w of windows) {
    if (Date.parse(w.joinedAt) <= t && t <= Date.parse(w.endedAt)) match = w;
  }
  if (!match) return null;
  return {
    eventId: match.eventId,
    series: match.series,
    kind: match.kind,
    joinedAt: match.joinedAt,
    // How long after the join the recording began: a wrong match shows up
    // as an odd gap.
    gapS: Math.round((t - Date.parse(match.joinedAt)) / 1000),
  };
}
