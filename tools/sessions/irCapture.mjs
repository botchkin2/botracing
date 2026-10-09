// The tray's iRacing live captures (desktop/src-tauri/src/capture/ir_*.rs), as
// the sync reads them: which captures belong to a session, the player stream,
// and the automatic check of the live lap times against the .ibt of the same
// drive (pit-wall thread 1, apex #2958): any lap more than 5 ms apart is logged.
//
// A capture is %LOCALAPPDATA%\lap-capture\<startUtc>_<track>_<session>\ with
// meta.json ({sim: 'iracing', track, startUtc, endUtc, ...}) and 60 s chunks
// player-NNNN.parquet (60 Hz, iRacing's own variable names), field-, session-.
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {columns, sqlPath} from './duck.mjs';
import {lapCrossings} from './iracing.mjs';
import {openIbt, readColumns} from './ibt.mjs';

/** A lap time further apart than this between live and .ibt is reported. */
export const LAP_TOLERANCE_S = 0.005;
/** Crossings within this of each other are the same lap on both sides. */
const SAME_CROSSING_S = 0.5;

export function listIracingCaptures(root) {
  if (!root || !existsSync(root)) return [];
  const out = [];
  for (const name of readdirSync(root)) {
    const dir = resolve(root, name);
    const metaPath = resolve(dir, 'meta.json');
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (meta.sim !== 'iracing') continue;
      const player = readdirSync(dir)
        .filter(f => /^player-\d+\.parquet$/.test(f))
        .sort()
        .map(f => resolve(dir, f));
      // When it last wrote a chunk: the end of a capture that was cut short.
      const lastMs = Math.max(0, ...player.map(f => statSync(f).mtimeMs));
      if (player.length) out.push({name, dir, meta, player, lastMs});
    } catch {
      // Being written or cut short mid-write: skipped this run.
    }
  }
  return out;
}

/** Captures of this track whose time overlaps [startMs, endMs]. */
export function iracingCapturesFor(captures, {track, startMs, endMs}) {
  return captures.filter(c => {
    if (c.meta.track !== track) return false;
    const from = Date.parse(c.meta.startUtc);
    // A capture with no endUtc was cut short: it ends at its last chunk.
    const to = c.meta.endUtc ? Date.parse(c.meta.endUtc) : c.lastMs;
    return from <= endMs && to >= startMs;
  });
}

const NEEDED = ['SessionTime', 'Lap', 'LapLastLapTime'];

/** The player stream's lap columns, in tick order, across the chunks. */
export function readLapColumns(files) {
  if (!files.length) return null;
  const src = `read_parquet([${files.map(sqlPath).join(', ')}])`;
  const c = columns(
    ':memory:',
    `SELECT ${NEEDED.join(', ')} FROM ${src} ORDER BY tick`,
  );
  return c.SessionTime ? c : null;
}

/** Lap crossings, [{t, lap, time}] (time 0 where the sim gave none). */
export function crossingsOf(c) {
  return lapCrossings(c.SessionTime, c.Lap, c.LapLastLapTime).map(
    ({t, lap, time}) => ({t, lap, time}),
  );
}

/** The .ibt files' lap crossings, read the same way as the live stream's. */
export function ibtCrossings(paths) {
  const out = [];
  for (const path of paths) {
    const cols = readColumns(openIbt(path), NEEDED);
    if (cols.SessionTime) out.push(...crossingsOf(cols));
  }
  return out;
}

/**
 * Live against .ibt, lap by lap. A lap is compared when both sides have a
 * time for the crossing at the same session clock. Returns what was compared,
 * the worst difference, and every lap over the tolerance.
 */
export function compareLaps(live, ibt, tolerance = LAP_TOLERANCE_S) {
  let compared = 0;
  let worst = 0;
  const bad = [];
  for (const a of live) {
    if (!(a.time > 0)) continue;
    const b = ibt.find(x => Math.abs(x.t - a.t) <= SAME_CROSSING_S);
    if (!b || !(b.time > 0)) continue;
    compared++;
    const diff = Math.abs(a.time - b.time);
    worst = Math.max(worst, diff);
    if (diff > tolerance)
      bad.push({lap: b.lap, live: a.time, ibt: b.time, diffS: diff});
  }
  return {compared, worstS: worst, bad};
}

/** One line for the sync log. */
export function describeCheck(r) {
  if (r.compared === 0) return 'live check: no lap in both';
  if (r.bad.length === 0)
    return `live check: ${r.compared} ${
      r.compared === 1 ? 'lap matches' : 'laps match'
    } the .ibt (worst ${(r.worstS * 1000).toFixed(3)} ms)`;
  const laps = r.bad
    .map(
      b =>
        `L${b.lap} ${(b.diffS * 1000).toFixed(1)} ms (live ${b.live}, ibt ${
          b.ibt
        })`,
    )
    .join('; ');
  return `live check: ${r.bad.length} of ${
    r.compared
  } laps differ by more than ${LAP_TOLERANCE_S * 1000} ms: ${laps}`;
}

/**
 * The check for one .ibt: its lap crossings against the live captures of the
 * same drive. null when there is no capture (the usual case before the tray
 * records, and for old files).
 */
export function liveLapCheck(root, span, ibtLaps) {
  const found = iracingCapturesFor(listIracingCaptures(root), {
    track: span.tracks[0],
    startMs: span.startMs,
    endMs: span.endMs,
  });
  if (!found.length) return null;
  const live = readLapColumns(found.flatMap(f => f.player));
  if (!live) return null;
  return compareLaps(crossingsOf(live), ibtLaps);
}
