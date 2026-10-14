// LMU adapter for the tray's live capture: the same archive lmu.mjs writes
// from a .duckdb (samples.parquet + events.parquet + the recording info), cut
// from the capture folder (tools/capture/README.md: player-NNNN 100 Hz
// TelemInfoV01, field-NNNN 5 Hz scoring per car, session-NNNN 5 Hz
// ScoringInfoV01, meta.json) for any half-open time window [t0, t1).
//
// A recording is one stretch of the session's mInRealtime flag, as the game's
// own .duckdb is (a race through pit-lane stops is one file; the garage after
// the flag is cut). Every value is a pure function of the capture around its
// own time, never of where the window starts, so per-lap parts read back
// through one glob equal a single window over the same span.
//
// Every channel is one value per player row (~100 Hz), so the info says hz 100
// for all. Where the .duckdb differs (LMU_CAPTURE_NOTES.md):
//   lap_dist_m        the last 5 Hz scoring mLapDist (or 0 at the crossing)
//                     plus the speed integrated since; the .duckdb has 10 Hz.
//                     Never below 0: scoring goes negative before the line on a
//                     rolling start, which the .duckdb holds at ~0.001.
//   path_lateral_m,   straight lines between the 5 Hz scoring rows.
//   track_edge_m
//   tyres_rubber_temp NOT in the capture: the mean of the three inner layers
//                     and the carcass, an approximation.
//   weather           the label of the stretch's first mCloudCoverage (skyLabel).
//   fuelSetup         the tank from mFuelCapacity; the fill limit lives in the
//                     car setup the capture does not have: null.
import {readdirSync, readFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {rows, run, sqlPath} from './duck.mjs';
import {
  channelSql,
  channelsInfo,
  eventList,
  playerCols,
  wheelSql,
  wheels,
} from './lmuCaptureChannels.mjs';

// Rows this far either side of a window: lag() needs the row before, a lap
// time comes from the first scoring row after its crossing, and lap distance
// and path lateral need the scoring rows around each player row. Larger than
// any gap in the fixtures (0.6 s).
const PAD_S = 2;
// The game's physics clock: every mElapsedTime is a multiple of 1/400 s, so
// this is a unique, window-independent row order.
const TICK_HZ = 400;
// Past an ended stretch's last row and under one 400 Hz step, so the trailing
// part keeps that row and nothing after it.
const END_PAD_S = 0.001;

// Under this from a stretch's end, a lap bump with no lap time is a reset.
const RESET_BUMP_S = 1;

// mCloudCoverage as the .duckdb's WeatherConditions names it. 0, 1 and 3
// checked against every capture with a .duckdb beside it (13, Sep-Oct 2026:
// the label is the first realtime row's value); 2 and 4 by the labels' order.
// Rain levels are not checked: ''.
const SKIES = [
  'Clear',
  'Light Clouds',
  'Partially Cloudy',
  'Mostly Cloudy',
  'Overcast',
];
export const skyLabel = cc => SKIES[cc] ?? '';

const chunkRe = /^(player|field|session)-\d+\.parquet$/;

// Each kind's chunks as a glob. The recorder writes .tmp and renames, so a
// capture still being written only ever shows whole *.parquet files. A glob,
// not the file list: a long session's list overruns the 32 KB Windows command
// line the DuckDB CLI gets its SQL on.
function chunks(dir) {
  const names = readdirSync(dir);
  const out = {};
  for (const kind of ['player', 'field', 'session']) {
    if (!names.some(name => chunkRe.test(name) && name.startsWith(kind)))
      throw new Error(`${basename(dir)}: no ${kind} chunks`);
    out[kind] = join(dir, `${kind}-*.parquet`);
  }
  return out;
}

const fileList = glob => sqlPath(glob);
const num = x => {
  if (!Number.isFinite(x)) throw new Error(`not a finite time: ${x}`);
  // A string cast parses the shortest round-trip form exactly; a bare literal
  // goes through DECIMAL and can land an ulp off a mLapStartET.
  return `'${x}'::DOUBLE`;
};

// rF2 session numbers: 0 test day, 1-4 practice, 5-8 qualifying, 9 warmup, 10-13 race.
function sessionType(session) {
  if (session >= 10 && session <= 13) return 'Race';
  if (session >= 5 && session <= 8) return 'Qualify';
  if (session === 9) return 'Warmup';
  return 'Practice';
}

function clockOf(seconds) {
  const s = Math.floor(Number(seconds));
  if (!Number.isFinite(s)) return '';
  const pad = v => String(v).padStart(2, '0');
  return `${pad(Math.floor(s / 3600) % 24)}:${pad(
    Math.floor(s / 60) % 60,
  )}:${pad(s % 60)}`;
}

// The session clock restarts inside one capture (a new session on the same
// server: 2 Oct 23:38 capture, 1201 s then 0.1 s). Each restart opens a clock
// epoch; rows are matched to a stretch by epoch (wall clock) and then by session
// time, since session times repeat across epochs. `epochSql(s)` names the
// epochs' wall-clock starts from session rows `s` with (w, e); `inEpoch(src)`
// tags any rows with wall_ms by the epoch they fall in.
const epochSql = s =>
  `ep AS (SELECT e, CASE WHEN e = 0 THEN 0 ELSE min(w) END w0 FROM ${s} GROUP BY e)`;
const inEpoch = src =>
  `(SELECT x.*, coalesce(ep.e, 0) e FROM ${src} x ASOF LEFT JOIN ep ON x.wall_ms >= ep.w0)`;

/**
 * The capture's recordings: one per stretch of mInRealtime on, in order.
 * Each has `key` (<folder>#<k>, stable as the capture grows), `info` (lmu.mjs
 * describe()'s shape), and `laps`: half-open [t0, t1) parts, the first from the
 * stretch start to the first crossing (partial), then crossing to crossing; a
 * stretch that has `ended` also lists its trailing part (partial). A lap still
 * being driven is not listed. `startMs`/`endMs`: the wall clock (epoch ms) of
 * the stretch's first and last row.
 * `lapTimeS` is the player's mLastLapTime just after the lap's closing
 * crossing, null when the game gave none and on partial parts.
 */
export function describeCapture(captureDir) {
  const files = chunks(captureDir);
  const meta = JSON.parse(readFileSync(join(captureDir, 'meta.json'), 'utf8'));
  const P = `read_parquet(${fileList(files.player)})`;
  const F = `(SELECT * FROM read_parquet(${fileList(
    files.field,
  )}) WHERE mIsPlayer)`;
  const S = `read_parquet(${fileList(files.session)})`;
  const [row] = rows(
    ':memory:',
    `WITH s0 AS (SELECT wall_ms w, mCurrentET t, mInRealtime r, mTimeOfDay tod, mSession ses, mCloudCoverage cc,
        lag(mCurrentET) OVER (ORDER BY wall_ms, mCurrentET) pt,
        coalesce(lag(mInRealtime) OVER (ORDER BY wall_ms, mCurrentET), false) pr FROM ${S}),
      s AS (SELECT *, coalesce(t < pt, false) rst,
        sum(CASE WHEN t < pt THEN 1 ELSE 0 END) OVER (ORDER BY w, t) e FROM s0),
      ${epochSql('s')},
      st AS (SELECT row_number() OVER (ORDER BY w, t) - 1 k, e, t onT, w onW, tod, ses, cc,
        (SELECT arg_min(CASE WHEN x.rst THEN x.pt + ${END_PAD_S} ELSE x.t END, x.w) FROM s x
          WHERE x.w > s.w AND (NOT x.r OR x.rst)) offT
        FROM s WHERE r AND (NOT pr OR rst)),
      p AS (SELECT st.k, st.e, mElapsedTime t, wall_ms, mLapNumber lap, mLapStartET ls, mFuelCapacity cap
        FROM ${inEpoch(P)} q JOIN st ON q.e = st.e AND mElapsedTime >= st.onT
          AND (st.offT IS NULL OR mElapsedTime < st.offT)),
      f AS (SELECT e, et, mTotalLaps, mLastLapTime, mVehicleName, mVehicleClass FROM ${inEpoch(
        F,
      )}),
      span AS (SELECT k, count(*) n, min(t) t0, max(t) t1, arg_min(wall_ms, t) wall0, arg_max(wall_ms, t) wall1,
        arg_min(cap, t) cap, arg_min(lap, t) lap0 FROM p GROUP BY k),
      cross_ AS (SELECT k, e, ls::DOUBLE ls, lap, t seen FROM (SELECT *, lag(lap) OVER (PARTITION BY k ORDER BY t) pl FROM p)
        WHERE pl IS NOT NULL AND lap IS DISTINCT FROM pl),
      timed AS (SELECT c.k, c.ls, c.lap, c.seen, f.mLastLapTime llt FROM cross_ c
        ASOF LEFT JOIN f ON f.e = c.e AND f.mTotalLaps = c.lap AND c.ls <= f.et),
      car AS (SELECT st.k, arg_min(mVehicleName, et) car, arg_min(mVehicleClass, et) cls
        FROM f JOIN st ON f.e = st.e AND f.et >= st.onT AND (st.offT IS NULL OR f.et < st.offT) GROUP BY st.k)
    SELECT to_json({
      stretches: (SELECT list({k: st.k, onT: st.onT, offT: st.offT, tod: st.tod, ses: st.ses, cc: st.cc,
        n: span.n, t0: span.t0, t1: span.t1, wall0: span.wall0, wall1: span.wall1, cap: span.cap, lap0: span.lap0,
        car: car.car, cls: car.cls} ORDER BY st.k)
        FROM st JOIN span USING (k) LEFT JOIN car USING (k)),
      crossings: (SELECT list({k: k, ls: ls, lap: lap, seen: seen, llt: llt} ORDER BY k, ls) FROM timed)
    }) j`,
  );
  const {stretches, crossings} = JSON.parse(row.j);
  const folder = basename(captureDir);
  return {
    stretches: (stretches || []).map(st => {
      const ended = st.offT != null || Boolean(meta.endUtc);
      let end = st.offT ?? st.t1 + END_PAD_S;
      const own = (crossings || []).filter(c => c.k === st.k && c.ls > st.t0);
      // A reset to the garage bumps mLapNumber with no lap time just before
      // realtime goes off (Silverstone 14 Oct: 0.03-0.14 s before). That is
      // not a crossing: the lap it cut is the stretch's trailing partial and
      // ends at the first row that shows the bump, as the .duckdb, which ends
      // mid-lap, has it. That row on is the reset itself (the tank already
      // refilled), and can sit a hair before the bump's mLapStartET.
      const bump = own.at(-1);
      if (ended && bump && end - bump.ls < RESET_BUMP_S && !(bump.llt > 0)) {
        own.pop();
        end = Math.min(bump.ls, bump.seen);
      }
      const laps = [];
      let from = st.t0;
      let lap = st.lap0;
      let partial = true;
      for (const c of own) {
        laps.push({
          lapNumber: lap,
          t0: from,
          t1: c.ls,
          partial,
          lapTimeS: !partial && c.llt > 0 ? c.llt : null,
        });
        from = c.ls;
        lap = c.lap;
        partial = false;
      }
      // Ended: realtime went off after it, or the recorder closed the capture
      // (endUtc). Its trailing part then runs to the realtime-off time, or
      // just past its last row.
      if (ended && end > from)
        laps.push({
          lapNumber: lap,
          t0: from,
          t1: end,
          partial: true,
          lapTimeS: null,
        });
      return {
        key: `${folder}#${st.k}`,
        ended,
        startMs: Number(st.wall0),
        endMs: Number(st.wall1),
        info: stretchInfo(meta, st),
        laps,
      };
    }),
  };
}

function stretchInfo(meta, st) {
  return {
    sim: 'lmu',
    source: 'capture',
    driver: meta.playerName || '',
    recordedAt: new Date(Number(st.wall0)).toISOString(),
    sessionClock: clockOf(st.tod),
    sessionType: sessionType(Number(meta.session ?? st.ses)),
    // The recorder has the scoring track name, which is the .duckdb's layout
    // ("Daytona International Speedway Road Course"); the venue alone is not
    // in the capture.
    track: meta.track || 'Unknown track',
    layout: meta.track || '',
    car: st.car || 'Unknown car',
    carClass: st.cls || '',
    fuelSetup: {fillLimitL: null, tankL: st.cap > 0 ? Number(st.cap) : null},
    weather: skyLabel(st.cc),
    baseHz: 100,
    ticks: Number(st.n),
    startT: Number(st.t0),
    endT: Number(st.t1),
    channels: channelsInfo(),
    events: eventList.map(([name, width]) => ({
      source: 'capture',
      name,
      unit: '',
      width,
    })),
  };
}

/**
 * Write samples.parquet and events.parquet for [t0, t1) of the recording that
 * `info` describes (describeCapture). One DuckDB run. Events at the
 * recording's start (info.startT) carry every state's first value, as the
 * .duckdb's do; any later window carries only changes inside it.
 */
export function writeCaptureArchive(
  captureDir,
  info,
  {t0, t1},
  samplesOut,
  eventsOut,
) {
  const files = chunks(captureDir);
  const wall0 = Date.parse(info.recordedAt);
  if (!Number.isFinite(wall0))
    throw new Error(`recording info has no recordedAt: ${info.recordedAt}`);
  // The rows of this recording's clock epoch (describeCapture): from the last
  // session clock restart at or before its start to the next one.
  const epoch = `wall_ms >= (SELECT coalesce(max(w), 0) FROM rs WHERE w <= ${wall0})
    AND wall_ms < (SELECT coalesce(min(w), 9e15) FROM rs WHERE w > ${wall0})`;
  const S0 = num(info.startT);
  const lo = num(Math.max(t0 - PAD_S, info.startT - PAD_S));
  const hi = num(t1 + PAD_S);
  const [a, b] = [num(t0), num(t1)];
  const inWin = col => `${col} >= ${a} AND ${col} < ${b}`;
  // The first state of a source whose rows started before the recording: the
  // last row at or before its start, else its first row.
  const fromStart = (table, col) =>
    `${col} >= coalesce((SELECT max(${col}) FROM ${table} WHERE ${col} <= ${S0}), ${S0})`;

  const samplesSelect = [
    `round((p.t - ${S0}) * ${TICK_HZ})::BIGINT AS tick`,
    'p.t::DECIMAL(12,4) AS t',
    ...channelSql.map(([name, , type, sql]) => `(${sql})::${type} AS ${name}`),
    ...wheelSql.flatMap(([name, , type, sql]) =>
      wheels.map(w => `(${sql(w)})::${type} AS ${name}_${w}`),
    ),
  ];
  // State events: a row whose value differs from the row before. A source's
  // first row (no row before) is the recording's initial state, at its start.
  const states = (table, col, name, values) => {
    const v = values.map((x, i) => `${x} AS v${i + 1}`).join(', ');
    const prev = values
      .map((x, i) => `lag(v${i + 1}) OVER (ORDER BY ${col}) AS q${i + 1}`)
      .join(', ');
    const changed = values
      .map((_, i) => `v${i + 1} IS DISTINCT FROM q${i + 1}`)
      .join(' OR ');
    const pad = [0, 1, 2, 3]
      .map(i => (i < values.length ? `v${i + 1}::DOUBLE` : 'NULL::DOUBLE'))
      .join(', ');
    return `SELECT greatest(${col}, ${S0}) AS t, '${name}' AS name, ${pad} FROM (
      SELECT *, ${prev} FROM (SELECT ${col}, ${v} FROM ${table} WHERE ${fromStart(
      table,
      col,
    )}))
      WHERE ${changed}`;
  };
  const initial = (name, value) =>
    `SELECT ${S0}, '${name}', ${value}, NULL, NULL, NULL`;

  const sql = `
SET threads TO 4;
CREATE TEMP TABLE rs AS SELECT w FROM (SELECT wall_ms w, mCurrentET t,
  lag(mCurrentET) OVER (ORDER BY wall_ms, mCurrentET) pt FROM read_parquet(${fileList(
    files.session,
  )})) WHERE t < pt;
CREATE TEMP TABLE p0 AS SELECT mElapsedTime AS t, ${playerCols
    .filter(c => c !== 'mElapsedTime')
    .join(', ')},
  sqrt(mLocalVel_x * mLocalVel_x + mLocalVel_y * mLocalVel_y + mLocalVel_z * mLocalVel_z) AS v
  FROM read_parquet(${fileList(
    files.player,
  )}) WHERE mElapsedTime >= ${lo} AND mElapsedTime < ${hi} AND ${epoch};
CREATE TEMP TABLE pl AS SELECT *, sum(seg) OVER (ORDER BY t) AS cum FROM (
  SELECT *, coalesce(0.5 * (v + lag(v) OVER (ORDER BY t)) * (t - lag(t) OVER (ORDER BY t)), 0) AS seg FROM p0);
CREATE TEMP TABLE pn AS SELECT t, cum, lead(t) OVER (ORDER BY t) AS tn, lead(cum) OVER (ORDER BY t) AS cn, v FROM pl;
CREATE TEMP TABLE f AS SELECT et, mTotalLaps AS lap, mLapDist AS d, mPathLateral AS lat, mTrackEdge AS edge,
  mLapStartET::DOUBLE AS ls, mLastLapTime AS llt, mCurSector1 AS s1, mCurSector2 AS s2, mInPits::INT AS pit
  FROM read_parquet(${fileList(
    files.field,
  )}) WHERE mIsPlayer AND et >= ${lo} AND et < ${hi} AND ${epoch};
CREATE TEMP TABLE s AS SELECT mCurrentET AS t, mYellowFlagState AS y, mSectorFlag_0 AS f0, mSectorFlag_1 AS f1,
  mSectorFlag_2 AS f2, mMinPathWetness AS w
  FROM read_parquet(${fileList(
    files.session,
  )}) WHERE mCurrentET >= ${lo} AND mCurrentET < ${hi} AND ${epoch};
-- The player rows from the recording's start, and its crossings.
CREATE TEMP TABLE pr AS SELECT *, lag(mLapNumber) OVER (ORDER BY t) AS plap,
  lag(mLastImpactET) OVER (ORDER BY t) AS pimp FROM pl WHERE t >= ${S0};
CREATE TEMP TABLE cr AS SELECT t AS seen, mLapStartET::DOUBLE AS ls, mLapNumber AS lap FROM pr
  WHERE plap IS NOT NULL AND mLapNumber IS DISTINCT FROM plap;
-- Lap distance anchors: every scoring row's mLapDist, and 0 at each crossing.
CREATE TEMP TABLE anc AS SELECT et AS at, d FROM f UNION ALL SELECT ls, 0 FROM cr;
-- An anchor before the first player row reads back along that row's speed.
CREATE TEMP TABLE ac AS SELECT anc.at, anc.d,
  CASE WHEN pn.t IS NULL THEN p1.cum - p1.v * (p1.t - anc.at)
       WHEN pn.tn IS NULL OR pn.tn = pn.t THEN pn.cum + pn.v * (anc.at - pn.t)
       ELSE pn.cum + (pn.cn - pn.cum) * (anc.at - pn.t) / (pn.tn - pn.t) END AS cum_at
  FROM anc ASOF LEFT JOIN pn ON anc.at >= pn.t
  CROSS JOIN (SELECT t, cum, v FROM pn ORDER BY t LIMIT 1) p1;
COPY (
  SELECT ${samplesSelect.join(', ')} FROM (
    SELECT p.*, greatest(ac.d + p.cum - ac.cum_at, 0) AS lap_dist,
      CASE WHEN fn.et IS NULL OR fn.et = fp.et THEN fp.lat ELSE fp.lat + (fn.lat - fp.lat) * (p.t - fp.et) / (fn.et - fp.et) END AS path_lateral,
      CASE WHEN fn.et IS NULL OR fn.et = fp.et THEN fp.edge ELSE fp.edge + (fn.edge - fp.edge) * (p.t - fp.et) / (fn.et - fp.et) END AS track_edge
    FROM (SELECT * FROM pl WHERE ${inWin('t')}) p
    ASOF LEFT JOIN ac ON p.t >= ac.at
    ASOF LEFT JOIN f fp ON p.t >= fp.et
    ASOF LEFT JOIN f fn ON p.t < fn.et
  ) p ORDER BY tick
) TO ${sqlPath(
    samplesOut,
  )} (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 9, ROW_GROUP_SIZE 100000);
COPY (
  SELECT * FROM (
    ${initial('lap_time', 0)}
    UNION ALL ${initial('sector1_time', 0)}
    UNION ALL ${initial('sector2_through_time', 0)}
    UNION ALL ${initial('impact', 0)}
    UNION ALL SELECT ${S0}, 'lap', mLapNumber, NULL, NULL, NULL FROM pr WHERE t = ${S0}
    UNION ALL SELECT c.ls, 'lap', c.lap, NULL, NULL, NULL FROM cr c
    UNION ALL SELECT c.ls, 'lap_time', f.llt, NULL, NULL, NULL FROM cr c
      ASOF LEFT JOIN f ON f.lap = c.lap AND c.ls <= f.et
    -- Sector times land at the lap's start plus the time, as the .duckdb's do.
    UNION ALL SELECT ls + s1, 'sector1_time', s1, NULL, NULL, NULL FROM (
      SELECT ls, s1, lag(s1) OVER (ORDER BY et) AS q, et FROM f WHERE ${fromStart(
        'f',
        'et',
      )})
      WHERE q IS NOT NULL AND s1 > 0 AND s1 IS DISTINCT FROM q
    UNION ALL SELECT ls + s2, 'sector2_through_time', s2, NULL, NULL, NULL FROM (
      SELECT ls, s2, lag(s2) OVER (ORDER BY et) AS q, et FROM f WHERE ${fromStart(
        'f',
        'et',
      )})
      WHERE q IS NOT NULL AND s2 > 0 AND s2 IS DISTINCT FROM q
    -- The .duckdb logs an impact as a 0.04 s true pulse, not its magnitude.
    UNION ALL SELECT greatest(mLastImpactET, ${S0}), 'impact', 1, NULL, NULL, NULL FROM pr
      WHERE pimp IS NOT NULL AND mLastImpactET > 0 AND mLastImpactET IS DISTINCT FROM pimp
    UNION ALL SELECT greatest(mLastImpactET, ${S0}) + 0.04, 'impact', 0, NULL, NULL, NULL FROM pr
      WHERE pimp IS NOT NULL AND mLastImpactET > 0 AND mLastImpactET IS DISTINCT FROM pimp
    UNION ALL ${states('pl', 't', 'gear', ['mGear'])}
    UNION ALL ${states(
      'pl',
      't',
      'surface',
      wheels.map(w => `${w}_mSurfaceType`),
    )}
    UNION ALL ${states(
      'pl',
      't',
      'tyres_compound',
      wheels.map(w => `${w}_mCompoundIndex`),
    )}
    -- Zero-based with the pit lane in the sign bit; the .duckdb counts 1, 2, 0.
    UNION ALL ${states('pl', 't', 'current_sector', [
      '((mCurrentSector & 2147483647) + 1) % 3',
    ])}
    UNION ALL ${states('f', 'et', 'in_pits', ['pit'])}
    UNION ALL ${states('s', 't', 'yellow_flag', ['y'])}
    UNION ALL ${states('s', 't', 'sector1_flag', ['f1'])}
    UNION ALL ${states('s', 't', 'sector2_flag', ['f2'])}
    UNION ALL ${states('s', 't', 'sector3_flag', ['f0'])}
    UNION ALL ${states('s', 't', 'minimum_path_wetness', ['w'])}
  ) e(t, name, v1, v2, v3, v4)
  WHERE ${inWin('t')} ORDER BY t, name
) TO ${sqlPath(eventsOut)} (FORMAT parquet, COMPRESSION zstd);`;
  run(':memory:', sql);
}
