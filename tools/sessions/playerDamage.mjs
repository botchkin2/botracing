// The car's damage over a session, from tools/capture's player stream.
//
// The recorder keeps the player car's whole telemetry struct at 100 Hz in
// `player-NNNN.parquet` next to the field. Two of its columns say whether the
// car is damaged: the eight panels' dent severity (`mDentSeverity_0..7`) and
// `mDetached` (a part is off). A pit stop that leaves fewer dented panels or
// detached parts than it entered with repaired something (pitVisit.mjs). The
// stream's `mElapsedTime` is the session clock the .duckdb's times use (checked
// on Road Atlanta 2026-10-02: the dent step at 1040.3 s is the game's impact
// event at 1040.36 s). Captures are pruned after a week, so older sessions have
// none and a visit there says so.
import {existsSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {columns, sqlPath} from './duck.mjs';
import {capturesFor, listCaptures} from './field.mjs';

/** The samples are kept at this rate: a repair is seconds long. */
export const DAMAGE_HZ = 2;

/**
 * {et, dent, detached} (parallel arrays sorted by et, DAMAGE_HZ per second,
 * the worst value in each step), or null when no capture covers the session.
 * `session`: {tracks, startMs, endMs} as for the field.
 */
export function damageFor(captureRoot, session) {
  const files = [];
  for (const c of capturesFor(listCaptures(captureRoot), session)) {
    const dir = resolve(captureRoot, c.name);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (/^player-\d+\.parquet$/.test(f)) files.push(resolve(dir, f));
    }
  }
  if (files.length === 0) return null;
  const dent = Array.from({length: 8}, (_, i) => `mDentSeverity_${i}`).join(
    ' + ',
  );
  const c = columns(
    ':memory:',
    `SELECT floor(mElapsedTime * ${DAMAGE_HZ}) / ${DAMAGE_HZ} AS et, ` +
      `max(${dent}) AS dent, max(CAST(mDetached AS INTEGER)) AS detached ` +
      `FROM read_parquet([${files.map(sqlPath).join(', ')}]) ` +
      `GROUP BY 1 ORDER BY 1`,
  );
  return {
    et: Array.from(c.et),
    dent: Array.from(c.dent),
    detached: Array.from(c.detached),
  };
}
