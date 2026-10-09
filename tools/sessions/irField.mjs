// Every car in an iRacing session at 5 Hz, from the tray's live capture
// (desktop/src-tauri/src/capture/ir_*.rs), in the same upload shape as LMU's
// field (field.mjs encode).
//
// What iRacing gives per car is lap distance (a share of the lap), overall
// position, laps completed and pit road: no world position, heading or offset
// from the line. So those channels stay absent (null in the file, NaN in the
// app), and anything that draws a car places it by lap distance, never by a
// position this file does not have (pit-wall thread 1, #2962 and #2963).
//
// The session clock of the capture's `session-` rows is the .ibt's
// SessionTime, so the two line up the same way LMU's do: checked, not assumed,
// by the player car's lap distance in both.
import {readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {columns, sqlPath} from './duck.mjs';
import {FIELD_HZ, MAX_ALIGN_M, alignment, encode} from './field.mjs';
import {carClasses} from './irClasses.mjs';
import {iracingCapturesFor, listIracingCaptures} from './irCapture.mjs';

// Recordings start and stop in the pits; keep the field a little either side.
const PAD_S = 30;

const filesOf = (dir, kind) =>
  readdirSync(dir)
    .filter(f => new RegExp(`^${kind}-\\d+\\.parquet$`).test(f))
    .sort()
    .map(f => resolve(dir, f));

// One capture's rows: a car at an update, with the session clock of that
// update. `update` restarts in every capture, so captures are read one by one.
function rowsOf(capture, fromEt, toEt, trackLengthM) {
  const field = filesOf(capture.dir, 'field');
  const session = filesOf(capture.dir, 'session');
  if (!field.length || !session.length) return null;
  const list = files => `[${files.map(sqlPath).join(', ')}]`;
  const c = columns(
    ':memory:',
    `SELECT s.SessionTime AS et, f.CarIdx AS id, ` +
      `f.CarIdxLapDistPct * ${trackLengthM} AS lapDist, ` +
      `f.CarIdxPosition AS place, f.CarIdxLapCompleted AS laps, ` +
      `CAST(f.CarIdxOnPitRoad AS INTEGER) AS inPits ` +
      `FROM read_parquet(${list(field)}) f ` +
      `JOIN read_parquet(${list(session)}) s ON f."update" = s."update" ` +
      // A car not in the world (the recorder already leaves it out) has no place.
      `WHERE s.SessionTime BETWEEN ${fromEt} AND ${toEt} AND f.CarIdxLapDistPct >= 0 ORDER BY et, id`,
  );
  return c.et && c.et.length ? c : null;
}

function concat(parts) {
  const out = {};
  for (const key of Object.keys(parts[0])) {
    out[key] = parts.flatMap(p => Array.from(p[key]));
  }
  return out;
}

/**
 * The session's field, or {field: null, reason}. Same contract as fieldFor.
 * `ibtDrivers` (irClasses.driversOfYaml of the session's .ibt) names the
 * classes when the capture predates the tray writing them.
 */
export function irFieldFor(root, span, recs, ibtDrivers = []) {
  const found = iracingCapturesFor(listIracingCaptures(root), {
    track: span.tracks[0],
    startMs: span.startMs,
    endMs: span.endMs,
  });
  if (!found.length) return {field: null, reason: 'no capture'};
  const length = found.find(f => f.meta.trackLengthM > 0)?.meta.trackLengthM;
  if (!length) return {field: null, reason: 'capture has no track length'};
  const fromEt = Math.min(...recs.map(r => r.t[0])) - PAD_S;
  const toEt = Math.max(...recs.map(r => r.t[r.t.length - 1])) + PAD_S;
  const parts = found.map(f => rowsOf(f, fromEt, toEt, length)).filter(Boolean);
  if (!parts.length)
    return {field: null, reason: 'capture has no rows in this session'};
  const c = concat(parts);
  c.flag = c.et.map(() => 0);

  // Cars: their class and model from the capture's own list (no names), the
  // player marked. Cars the list does not know keep an empty class. The class
  // id and its label come from the capture, else from the .ibt (irClasses.mjs).
  const known = new Map();
  let playerIdx = -1;
  for (const f of found) {
    if (f.meta.playerCarIdx != null) playerIdx = f.meta.playerCarIdx;
    for (const car of f.meta.cars ?? []) known.set(car.carIdx, car);
  }
  const classes = carClasses([...known.values()], ibtDrivers);
  const firstSeen = new Map();
  c.id.forEach((id, k) => {
    if (!firstSeen.has(id)) firstSeen.set(id, c.et[k]);
  });
  const cars = [...firstSeen.keys()]
    .sort((a, b) => firstSeen.get(a) - firstSeen.get(b) || a - b)
    .map(id => ({
      id,
      class: known.get(id)?.className ?? '',
      vehicle: known.get(id)?.carName || null,
      player: id === playerIdx,
      ...(classes.has(id) ? classes.get(id) : {}),
    }));

  const player = {et: [], lapDist: []};
  for (let k = 0; k < c.et.length; k++) {
    if (c.id[k] === playerIdx) {
      player.et.push(c.et[k]);
      player.lapDist.push(c.lapDist[k]);
    }
  }
  const alignM = alignment(player, recs);
  if (alignM === null)
    return {field: null, reason: 'player car not in both sources'};
  if (alignM > MAX_ALIGN_M)
    return {
      field: null,
      reason: `clocks disagree: player ${alignM.toFixed(1)} m apart`,
    };

  const body = encode(c, cars);
  return {
    field: body,
    meta: {
      hz: FIELD_HZ,
      cars: cars.length,
      durationS: Math.round(body.tDs[body.tDs.length - 1] / 10),
      captures: found.map(f => f.name),
      alignM: Math.round(alignM * 10) / 10,
    },
  };
}
