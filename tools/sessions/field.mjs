// Every car in a session at 5 Hz, from tools/capture's local captures.
//
// The recorder writes the field to %LOCALAPPDATA%\lap-capture\<capture>\
// field-NNNN.parquet (tools/capture/README.md). A session picks the captures
// whose time window overlaps its own and whose track matches, then aligns them
// on the game's session clock: the field rows' `et` and the .duckdb's GPS Time
// are the same clock. That is checked, not assumed: the player car is in both,
// so its lap distance must agree (pitlane, pit-wall thread 30 #627).
//
// What uploads carries no names: cars are an index per session, with class,
// vehicle and whether it is the player. Car numbers plus the public event id
// would name every driver in one lookup (#626, #627).
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {columns, rows, sqlPath} from './duck.mjs';

export const FIELD_HZ = 5;
// Median player lap-distance disagreement above this means the clocks do not
// line up (a restart or rejoin reset the session clock): no field for this
// session rather than every car shifted.
export const MAX_ALIGN_M = 20;
// Recordings start and stop in the pits; keep the field a little either side.
const PAD_S = 30;

export function listCaptures(root) {
  if (!root || !existsSync(root)) return [];
  const out = [];
  for (const name of readdirSync(root)) {
    const metaPath = resolve(root, name, 'meta.json');
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      // LMU's captures only: this reads LMU's columns (the iRacing tray
      // recorder shares the folder; irCapture.mjs reads those).
      if (meta.sim && meta.sim !== 'lmu') continue;
      const files = readdirSync(resolve(root, name))
        .filter(f => /^field-\d+\.parquet$/.test(f))
        .map(f => resolve(root, name, f));
      // When it last wrote a chunk: the end of a capture that was cut short.
      const lastMs = Math.max(0, ...files.map(f => statSync(f).mtimeMs));
      if (files.length) out.push({name, meta, files, lastMs});
    } catch {
      // A capture being written or cut short mid-write: skip it this run.
    }
  }
  return out;
}

// Captures on one of these track names whose time overlaps [startMs, endMs].
// The recorder has the scoring name ("Daytona International Speedway Road
// Course"); the .duckdb has a venue and a layout name, so both are tried.
// A capture cut short (crash, kill, power) has no endUtc; it ends at its last
// chunk. Treating it as open would join it to every later session on the
// track, and the session clock restarts near zero each time (scrutineer #682).
export function capturesFor(captures, {tracks, startMs, endMs}) {
  return captures.filter(c => {
    if (!tracks.includes(c.meta.track)) return false;
    const from = Date.parse(c.meta.startUtc);
    const to = c.meta.endUtc ? Date.parse(c.meta.endUtc) : c.lastMs;
    return from <= endMs && to >= startMs;
  });
}

// A car's model for the upload, or null. Only the telemetry model name the
// recorder mapped per car id, never the entry name (which carries the car
// number, and on custom entries sometimes a person's name: #680, #681).
export function modelOf(models, id) {
  const model = String(models?.[id] ?? '').trim();
  return model && !/#\d/.test(model) ? model : null;
}

// Wrap-aware distance between two lap positions on a lap of length L.
function lapGap(a, b, L) {
  const d = Math.abs(a - b);
  return L > 0 ? Math.min(d, L - d) : d;
}

function nearest(t, x) {
  let lo = 0;
  let hi = t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && x - t[lo - 1] < t[lo] - x ? lo - 1 : lo;
}

// Median |player lap distance, field minus .duckdb| at the same session time.
// recs: [{t: Float64Array (GPS Time), lapDist: Float64Array}]. null when the
// two never overlap.
export function alignment(player, recs) {
  let L = 0; // lap length: the largest lap distance seen
  for (const r of recs) {
    for (const d of r.lapDist) if (d > L) L = d;
  }
  const gaps = [];
  for (let i = 0; i < player.et.length; i++) {
    const rec = recs.find(
      r => r.t[0] <= player.et[i] && player.et[i] <= r.t[r.t.length - 1],
    );
    if (!rec) continue;
    const j = nearest(rec.t, player.et[i]);
    if (Math.abs(rec.t[j] - player.et[i]) > 0.05) continue;
    gaps.push(lapGap(player.lapDist[i], rec.lapDist[j], L));
  }
  if (gaps.length < 10) return null;
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1];
}

// Heading in integer centiradians (0.01 rad, 0.57°: enough to turn a radar
// blip, and 16% instead of 35% on the file's gzip size), in the same convention as
// atan2(dx, dz) of consecutive x/z positions: 0 along +z, +π/2 along +x.
// mOri_2 is the car's local +z axis (backwards) in world coordinates, and the
// world x/z are mirrored against it, so heading = atan2(oriZ.x, -oriZ.z).
// Checked on the 2026-09-29 Daytona capture: 62 cars, 36,356 samples above
// 10 m/s, median 0.012 rad and p95 0.048 rad from the direction of travel.
export function yawCrad(oriZx, oriZz) {
  return Math.round(Math.atan2(oriZx, -oriZz) * 100);
}

// Rows (one per car per update, sorted by et) to the upload's columnar shape.
// Positions and heading are integers (decimetres, centiradians), delta-encoded
// per car; null where a car was absent (the decoder keeps its last value
// through the gap). Heading wraps at ±π, so its deltas jump by 2π (628) at
// the wrap; the running sum still gives the wrapped heading.
export function encode(r, cars) {
  const updates = [...new Set(r.et)].sort((a, b) => a - b);
  const at = new Map(updates.map((et, i) => [et, i]));
  const index = new Map(cars.map((c, i) => [c.id, i]));
  const n = updates.length;
  const grid = () => cars.map(() => new Array(n).fill(null));
  const out = {
    v: 2,
    hz: FIELD_HZ,
    et0: updates[0],
    tDs: updates.map(et => Math.round((et - updates[0]) * 10)),
    cars: cars.map((c, i) => ({
      i,
      class: c.class,
      vehicle: c.vehicle,
      player: c.player,
    })),
    lapDistDm: grid(),
    pathLateralDm: grid(),
    xDm: grid(),
    zDm: grid(),
    yawCrad: grid(),
    place: grid(),
    laps: grid(),
    inPits: grid(),
    flag: grid(),
  };
  const dm = v => Math.round(v * 10);
  for (let k = 0; k < r.et.length; k++) {
    const car = index.get(r.id[k]);
    const u = at.get(r.et[k]);
    if (car === undefined) continue;
    out.lapDistDm[car][u] = dm(r.lapDist[k]);
    out.pathLateralDm[car][u] = dm(r.pathLateral[k]);
    out.xDm[car][u] = dm(r.x[k]);
    out.zDm[car][u] = dm(r.z[k]);
    out.yawCrad[car][u] = yawCrad(r.oriX[k], r.oriZ[k]);
    out.place[car][u] = r.place[k];
    out.laps[car][u] = r.laps[k];
    out.inPits[car][u] = r.inPits[k] ? 1 : 0;
    out.flag[car][u] = r.flag[k];
  }
  for (const key of ['lapDistDm', 'pathLateralDm', 'xDm', 'zDm', 'yawCrad']) {
    out[key] = out[key].map(deltas);
  }
  return out;
}

function deltas(values) {
  let last = 0;
  return values.map(v => {
    if (v === null) return null;
    const d = v - last;
    last = v;
    return d;
  });
}

// Inverse of the delta step, for tests and for anyone reading the file.
export function undelta(values) {
  let last = 0;
  return values.map(d => (d === null ? null : (last += d)));
}

function readRows(files, models, fromEt, toEt) {
  const src = `read_parquet([${files.map(sqlPath).join(', ')}])`;
  const where = `WHERE et BETWEEN ${fromEt} AND ${toEt}`;
  const c = columns(
    ':memory:',
    `SELECT et, mID AS id, mIsPlayer AS player, mPlace AS place, mTotalLaps AS laps, ` +
      `mLapDist AS lapDist, mPathLateral AS pathLateral, mPos_x AS x, mPos_z AS z, ` +
      `mOri_2_x AS oriX, mOri_2_z AS oriZ, mInPits AS inPits, mFlag AS flag FROM ${src} ${where} ORDER BY et, mID`,
  );
  const cars = rows(
    ':memory:',
    `SELECT mID AS id, any_value(mVehicleClass) AS class, ` +
      `bool_or(mIsPlayer) AS player, min(et) AS first FROM ${src} ${where} GROUP BY mID ORDER BY first, mID`,
  ).map(row => ({
    id: Number(row.id),
    class: row.class || '',
    vehicle: modelOf(models, row.id),
    player: row.player === 'true',
  }));
  return {c, cars};
}

// The session's field, or {field: null, reason}.
// session: {tracks, startMs, endMs}; recs: [{t, lapDist}] from the .duckdb.
export function fieldFor(root, session, recs) {
  const found = capturesFor(listCaptures(root), session);
  if (!found.length) return {field: null, reason: 'no capture'};
  const fromEt = Math.min(...recs.map(r => r.t[0])) - PAD_S;
  const toEt = Math.max(...recs.map(r => r.t[r.t.length - 1])) + PAD_S;
  const models = Object.assign(
    {},
    ...found.map(f => f.meta.vehicleModels || {}),
  );
  const {c, cars} = readRows(
    found.flatMap(f => f.files),
    models,
    fromEt,
    toEt,
  );
  if (!c.et || c.et.length === 0)
    return {field: null, reason: 'capture has no rows in this session'};
  const player = {et: [], lapDist: []};
  for (let k = 0; k < c.et.length; k++) {
    if (c.player[k]) {
      player.et.push(c.et[k]);
      player.lapDist.push(c.lapDist[k]);
    }
  }
  const alignM = alignment(player, recs);
  if (alignM === null)
    return {field: null, reason: 'player car not in both sources'};
  if (alignM > MAX_ALIGN_M) {
    return {
      field: null,
      reason: `clocks disagree: player ${alignM.toFixed(1)} m apart`,
    };
  }
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

// What the session keeps after a sync. A sync that found no field (captures
// pruned after 7 days, a sync from a shell that can't see the capture folder,
// a failed clock check) keeps the stored one instead of wiping it; only a new
// field that joined and passed the clock check replaces it (scrutineer #693).
// Returns {field, upload, deletePath}.
export function fieldAfterSync(fresh, stored) {
  if (!fresh) return {field: stored ?? null, upload: false, deletePath: null};
  const deletePath =
    stored?.path && stored.path !== fresh.path ? stored.path : null;
  return {field: fresh, upload: true, deletePath};
}
