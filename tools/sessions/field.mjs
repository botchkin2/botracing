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
import {sessionTypeOf} from './lmuCapture.mjs';

// Same share as liveSession.mjs MIN_COVER_SHARE. Not imported: liveSession.mjs
// loads analyzeFromArchive, which reaches this file through lapTraffic and
// fieldTags. A cycle leaves the share undefined. field.test.mjs checks equality.
export const MIN_COVER_SHARE = 0.5;

export const FIELD_HZ = 5;
// Median player lap-distance disagreement above this means the clocks do not
// line up (a restart or rejoin reset the session clock). The field is still
// stored, with mark kind 'misaligned', and the screen says how far off it is.
export const MAX_ALIGN_M = 20;
// Recordings start and stop in the pits; keep the field a little either side.
const PAD_S = 30;

// The recorder counts its layout looks (recorder.rs note_layout_check): a
// capture is doubted only when the doubt held for most of the drive, for the
// scoring or the player looks alike. One bad beat at a session load does not
// cost the drive; `goodRows` judges the rows.
export const captureDoubted = meta =>
  (meta.playerDoubtful ?? 0) * 2 > (meta.playerChecks ?? 0) ||
  (meta.layoutDoubtful ?? 0) * 2 > (meta.layoutChecks ?? 0);

export function listCaptures(root, {suspect = null} = {}) {
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
      // A doubted capture is used (audit row 3). `suspect: true` is only the
      // doubted ones; `suspect: false` is only the clean ones.
      const doubted = captureDoubted(meta);
      if (suspect === true && !doubted) continue;
      if (suspect === false && doubted) continue;
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
      // The game's best lap in seconds (null: no timed lap); absent for a sim
      // that gives none (iRacing), where the bests come from the laps.
      ...(c.bestLapS !== undefined ? {bestLapS: c.bestLapS} : {}),
      // iRacing's class id and label (irClasses.mjs); LMU names its class.
      ...(c.classId != null
        ? {classId: c.classId, classLabel: c.classLabel}
        : {}),
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
    // A sim that gives no position (iRacing: lap distance only) leaves these
    // channels null: absent, not zero.
    if (r.pathLateral) out.pathLateralDm[car][u] = dm(r.pathLateral[k]);
    if (r.x && r.z) {
      out.xDm[car][u] = dm(r.x[k]);
      out.zDm[car][u] = dm(r.z[k]);
    }
    if (r.oriX && r.oriZ) out.yawCrad[car][u] = yawCrad(r.oriX[k], r.oriZ[k]);
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

// A wrong layout garbles every car's lap distance; a car in a long pit lane
// reads far below zero but is real (Sebring -1664 m). Garbage is non-finite or
// beyond 100 km, the recorder's own bound (sanity.rs).
export const LAP_DIST_BOUND_M = 100_000;
const garbage = d => !(Number.isFinite(d) && Math.abs(d) < LAP_DIST_BOUND_M);

// The rows without a garbage lap distance, or null when over a quarter are
// garbage (a wrong layout, whatever the mark says).
export function goodRows(c) {
  const n = c.et.length;
  const keep = [];
  for (let k = 0; k < n; k++) if (!garbage(c.lapDist[k])) keep.push(k);
  if ((n - keep.length) * 4 > n) return null;
  if (keep.length === n) return c;
  return Object.fromEntries(
    Object.entries(c).map(([key, col]) => [key, keep.map(k => col[k])]),
  );
}

// duck.mjs hands a SQL NULL back as an empty string: only a positive number is a lap.
const bestOf = v => (Number(v) > 0 ? Number(v) : null);

function readRows(files, models, fromEt, toEt) {
  const src = `read_parquet([${files.map(sqlPath).join(', ')}])`;
  // A capture from before the recorder wrote the game's best lap has no such column.
  const hasBest = Object.keys(
    columns(':memory:', `SELECT * FROM ${src} LIMIT 0`),
  ).includes('mBestLapTime');
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
      `bool_or(mIsPlayer) AS player, min(et) AS first, ` +
      // The game's own best lap so far per car (-1 until it has one): the lowest
      // positive reading is its final best (classBests v2, pit-wall #4687).
      (hasBest ? 'min(mBestLapTime) FILTER (WHERE mBestLapTime > 0)' : 'NULL') +
      ` AS bestLap FROM ${src} ${where} GROUP BY mID ORDER BY first, mID`,
  ).map(row => ({
    id: Number(row.id),
    class: row.class || '',
    vehicle: modelOf(models, row.id),
    player: row.player === 'true',
    ...(hasBest ? {bestLapS: bestOf(row.bestLap)} : {}),
  }));
  return {c, cars};
}

// What the session says when it has no field, in words for the person who
// drove it (the Field screen shows it as is): the analysis reason in, the line
// out. Every reason has one, so no session without a field is silent.
export function fieldMissingText(reason) {
  if (reason === 'capture marked suspect') return 'Other cars: recording doubted';
  if (reason === 'capture game data not recognised')
    return 'Other cars: game data unreadable';
  if (
    reason === 'capture has no rows in this session' ||
    reason?.startsWith('clocks disagree') ||
    reason === 'player car not in both sources'
  )
    return "Other cars: recording doesn't match the game file";
  if (reason === 'no capture' || reason == null)
    return 'Other cars: not recorded';
  // Not a verdict on the drive: iRacing's field comes with the game file, a
  // live lap that could not make one tries again on the next.
  return null;
}

// The session doc's `fieldMissing`: null with a field; else why, in words. A
// run that gave no reason (the cloud analysis has no capture to read) keeps the
// stored line, and a session never told why says it was not recorded.
export function fieldMissingAfter(field, reason, stored) {
  if (field) return null;
  if (reason == null) return stored ?? fieldMissingText(null);
  return fieldMissingText(reason) ?? stored ?? null;
}

const MARK_RANK = {garbage: 5, misaligned: 4, track: 3, doubted: 2, smaller: 1};

/** The one mark the screen shows, strongest first. */
export function pickMark(marks) {
  const list = marks.filter(Boolean);
  if (!list.length) return null;
  return list.reduce((a, b) =>
    (MARK_RANK[b.kind] ?? 0) > (MARK_RANK[a.kind] ?? 0) ? b : a,
  );
}

// These marks are kept on the session and shown. They do not feed traffic,
// class laps, bests, or the finish (thread 100). `smaller` is not in the
// set: it names a file held aside, and the field the session points at is
// still the one those blocks are read from.
const UNUSED_MARKS = new Set(['garbage', 'misaligned', 'track', 'doubted']);

/** False when this field must not feed anything derived from it. */
export function fieldFeedsDerived(field) {
  return !UNUSED_MARKS.has(field?.mark?.kind);
}

/** One line for a marked field (gauge #6846). Null when there is no mark. */
export function fieldMarkText(mark) {
  if (!mark) return null;
  if (mark.kind === 'doubted') return 'Other cars: recording doubted';
  if (mark.kind === 'misaligned')
    return mark.alignM == null
      ? "Other cars: recording doesn't match the game file"
      : `Other cars: offset from the game file, ${mark.alignM} m`;
  if (mark.kind === 'garbage') return 'Other cars: recording not drawn';
  if (mark.kind === 'track')
    return `Other cars: track name does not match (${mark.capture})`;
  if (mark.kind === 'smaller')
    return 'Other cars: a smaller recording was kept aside';
  return null;
}

function captureWindow(c) {
  const from = Date.parse(c.meta.startUtc);
  const to = c.meta.endUtc ? Date.parse(c.meta.endUtc) : c.lastMs;
  return {from, to};
}

// The recorder's session number, or null when the capture never wrote one.
function captureSessionType(meta) {
  if (meta.session == null || meta.session === '') return null;
  const n = Number(meta.session);
  return Number.isFinite(n) ? sessionTypeOf(n) : null;
}

/**
 * One capture for a session whose track name did not match (audit row 6).
 * The #712 cover rule (liveSession.mjs liveCover): same sim, same session
 * type where both are known, overlap at least MIN_COVER_SHARE of the shorter
 * span, and the largest overlap wins. A practice file that only brushes a
 * qualifying session does not join.
 */
export function capturesOverlapping(captures, session) {
  const {startMs, endMs, sim = 'lmu', sessionType = null} = session;
  let best = null;
  let bestMs = 0;
  for (const c of captures) {
    const capSim = c.meta.sim || 'lmu';
    if (sim && capSim !== sim) continue;
    const capType = captureSessionType(c.meta);
    if (sessionType && capType && capType !== sessionType) continue;
    const {from, to} = captureWindow(c);
    const overlapMs = Math.min(endMs, to) - Math.max(startMs, from);
    const shorterMs = Math.min(endMs - startMs, to - from);
    if (!(overlapMs > 0) || overlapMs < MIN_COVER_SHARE * shorterMs) continue;
    if (overlapMs > bestMs) {
      best = c;
      bestMs = overlapMs;
    }
  }
  return best ? [best] : [];
}

/**
 * Encode `c` and attach the marks. A clock that does not agree still stores
 * the field (audit row 4). `player` is `{et, lapDist}` for the player car.
 */
export function settleField({c, cars, player, recs, captures, marks = []}) {
  const alignM = alignment(player, recs);
  const rounded = alignM == null ? null : Math.round(alignM * 10) / 10;
  const next = [...marks];
  if (alignM === null || alignM > MAX_ALIGN_M)
    next.push({kind: 'misaligned', alignM: rounded});
  const body = encode(c, cars);
  const mark = pickMark(next);
  const note = fieldMarkText(mark);
  return {
    field: body,
    meta: {
      hz: FIELD_HZ,
      cars: cars.length,
      durationS: body.tDs?.length
        ? Math.round(body.tDs[body.tDs.length - 1] / 10)
        : 0,
      captures,
      alignM: rounded,
      ...(mark ? {mark, note} : {}),
    },
  };
}

function playerOf(c) {
  const player = {et: [], lapDist: []};
  for (let k = 0; k < c.et.length; k++) {
    if (c.player[k]) {
      player.et.push(c.et[k]);
      player.lapDist.push(c.lapDist[k]);
    }
  }
  return player;
}

// The session's field, or {field: null, reason}. A check that used to drop the
// field stores it with meta.mark instead (audit rows 3-6).
// session: {tracks, startMs, endMs}; recs: [{t, lapDist}] from the .duckdb.
export function fieldFor(root, session, recs) {
  const all = listCaptures(root);
  let found = capturesFor(all, session);
  const marks = [];
  if (!found.length) {
    found = capturesOverlapping(all, session);
    if (found.length)
      marks.push({
        kind: 'track',
        capture: found.map(f => f.meta.track).filter(Boolean).join(', '),
      });
  }
  if (!found.length) return {field: null, reason: 'no capture'};
  if (found.some(f => captureDoubted(f.meta))) marks.push({kind: 'doubted'});
  const fromEt = Math.min(...recs.map(r => r.t[0])) - PAD_S;
  const toEt = Math.max(...recs.map(r => r.t[r.t.length - 1])) + PAD_S;
  const models = Object.assign(
    {},
    ...found.map(f => f.meta.vehicleModels || {}),
  );
  const read = readRows(
    found.flatMap(f => f.files),
    models,
    fromEt,
    toEt,
  );
  const {cars} = read;
  if (!read.c.et || read.c.et.length === 0)
    return {field: null, reason: 'capture has no rows in this session'};
  const n = read.c.et.length;
  let bad = 0;
  for (let k = 0; k < n; k++) if (garbage(read.c.lapDist[k])) bad++;
  const majority = bad * 4 > n;
  const c = majority ? read.c : goodRows(read.c);
  if (majority) marks.push({kind: 'garbage'});
  return settleField({
    c,
    cars,
    player: playerOf(c),
    recs,
    captures: found.map(f => f.name),
    marks,
  });
}

// What the session keeps after a sync. No new field keeps the stored one.
// A new field replaces it when it covers at least as much (cars × seconds)
// and its mark is not stronger. A stronger mark is a worse field (garbage
// outranks misaligned, then track, doubted, smaller): it is stored beside
// the cleaner file and that file is not deleted. `aside` sits on the field
// itself, so the mark the screen shows cannot drop the path (audit row 15).
// Returns {field, upload, deletePath, keptAside}.
const spanOf = f => (Number(f?.cars) || 0) * (Number(f?.durationS) || 0);
const markRank = mark => MARK_RANK[mark?.kind] ?? 0;

function holdAside(stored, fresh) {
  const smaller = spanOf(fresh) < spanOf(stored);
  const mark =
    !stored.mark && smaller ? {kind: 'smaller', aside: fresh.path} : stored.mark;
  const field = {...stored, aside: fresh.path};
  if (mark) {
    field.mark = mark;
    field.note = fieldMarkText(mark);
  }
  return {field, upload: false, deletePath: null, keptAside: fresh};
}

export function fieldAfterSync(fresh, stored) {
  const none = {field: stored ?? null, upload: false, deletePath: null, keptAside: null};
  if (!fresh) return none;
  if (!stored?.path || stored.path === fresh.path)
    return {field: fresh, upload: true, deletePath: null, keptAside: null};
  if (markRank(fresh.mark) > markRank(stored.mark) || spanOf(fresh) < spanOf(stored))
    return holdAside(stored, fresh);
  return {field: fresh, upload: true, deletePath: stored.path, keptAside: null};
}

// A block worked out from the field (result, classLaps, classBests) names the
// field file it was read from, and a stored one is kept only while the session
// still points at that file. A live session's field grows every lap under a
// new name, so a block kept on its version alone stayed what the first lap
// gave: the 2026-10-21 Sebring race read his grid slot as his finish (pit wall
// thread 98).
export function stampField(block, field) {
  return block ? {...block, fieldHash: field?.hash ?? null} : block;
}

export function madeFromField(block, field) {
  return Boolean(block && field?.hash && block.fieldHash === field.hash);
}
