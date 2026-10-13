// iRacing adapter for the tray's live capture: the same archive iracing.mjs
// writes from an .ibt (samples.parquet + events.parquet + the recording info),
// cut from the capture folder (desktop/src-tauri/src/capture/ir_*.rs:
// player-NNNN 60 Hz with iRacing's own variable names and the sim's tick,
// field-/session-NNNN 5 Hz, meta.json with what ir_session.rs keeps of the
// session text) for any half-open time window [t0, t1) on the session clock.
// Same contract as lmuCapture.mjs (IR_CAPTURE_NOTES.md).
//
// A recording is one IsOnTrack stretch, as an .ibt is: the recorder writes a
// player row only while the player is in the car and not in a replay, so a
// stretch is a run of rows with no gap in the sim's tick over STRETCH_GAP_TICKS.
// Every value is a pure function of the capture around its own time, never of
// where the window starts, so per-lap parts read back through one glob equal a
// single window over the same span. The channels and events are iracing.mjs's,
// computed the same way (its lapCrossings, steerScale, surface codes, reset and
// sector rules), so an .ibt and a capture of the same drive analyse alike.
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {basename, join} from 'node:path';
import {rows, run, sqlPath} from './duck.mjs';
import {carClasses} from './irClasses.mjs';
import {
  CHANNELS,
  RESET_LEAD_S,
  RESET_REFILL_L,
  YELLOW,
  fuelSetupOf,
  lapCrossings,
  mapSessionType,
  slug,
  steerScale,
  surfaceSql,
} from './iracing.mjs';
import {raceLengthOfSessions} from './raceLength.mjs';

const HZ = 60;
// A gap in the sim's tick longer than this (1 s) ends a stretch: the player got
// out of the car or watched a replay. Shorter gaps are missed ticks (the
// recorder counts those) or a reset's one-tick blink, which the .ibt keeps in
// one file too (Sebring 9 Oct, 1381.5 s).
const STRETCH_GAP_TICKS = 60;
// lapCrossings looks this far past a crossing for the sim's lap time.
const LAP_TIME_WAIT_S = 3;
// Rows before a window: a change needs the row before, a reset looks back
// RESET_LEAD_S for the refill.
const PAD_S = 2;
// Past an ended stretch's last row and under one 60 Hz step.
const END_PAD_S = 0.001;

const playerRe = /^player-\d+\.parquet$/;

// The player chunks as a glob (lmuCapture.mjs: a list overruns the command line).
function playerGlob(dir) {
  if (!readdirSync(dir).some(name => playerRe.test(name)))
    throw new Error(`${basename(dir)}: no player chunks`);
  return sqlPath(join(dir, 'player-*.parquet'));
}

const num = x => {
  if (!Number.isFinite(x)) throw new Error(`not a finite number: ${x}`);
  return `'${x}'::DOUBLE`;
};

const readMeta = dir => {
  const path = join(dir, 'meta.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
};

// Where a stretch starts: the first row, or a row after a tick gap, a tick or
// session clock that went back, or a new session number. Over `r` with
// w, tick, t, sn and their lags pw, ptick, pt, psn.
const breakSql = `CASE WHEN ptick IS NULL THEN 0
  WHEN tick - ptick > ${STRETCH_GAP_TICKS} OR tick <= ptick OR t < pt OR sn IS DISTINCT FROM psn
  THEN 1 ELSE 0 END`;

// Lap-number changes of each stretch k in `q` (k, tick, t, lap, llt), with the
// row before each and the first row after it, within LAP_TIME_WAIT_S and before
// the next change, whose LapLastLapTime differs: every row lapCrossings looks at.
const crossingCtes = q => `
  chg AS (SELECT *, lead(tick) OVER (PARTITION BY k ORDER BY tick) nt FROM (
    SELECT *, lag(lap) OVER o pl, lag(tick) OVER o ptk, lag(t) OVER o ppt, lag(llt) OVER o pllt
    FROM ${q} WINDOW o AS (PARTITION BY k ORDER BY tick))
    WHERE pl IS NOT NULL AND lap IS DISTINCT FROM pl),
  jr AS (SELECT c.k, c.tick, arg_min({tick: x.tick, t: x.t, llt: x.llt}, x.tick) j
    FROM chg c JOIN ${q} x ON x.k = c.k AND x.tick > c.tick AND (c.nt IS NULL OR x.tick < c.nt)
      AND x.t <= c.t + ${LAP_TIME_WAIT_S} AND x.llt IS DISTINCT FROM c.llt
    GROUP BY c.k, c.tick),
  cross_ AS (SELECT c.k, list({tick: c.tick, t: c.t, lap: c.lap, llt: c.llt, ptk: c.ptk, ppt: c.ppt,
      pl: c.pl, pllt: c.pllt, j: jr.j} ORDER BY c.tick) cs
    FROM chg c LEFT JOIN jr USING (k, tick) GROUP BY c.k)`;

/**
 * lapCrossings over a stretch, from the rows it looks at (crossingCtes): the
 * first row, each change, the row before it and the lap-time row after it.
 * The other rows cannot change its result, so this is lapCrossings over the
 * whole stretch.
 */
function stretchCrossings(first, changes) {
  const at = new Map();
  const put = (tick, t, lap, llt) => {
    if (!at.has(tick)) at.set(tick, {tick, t, lap, llt});
  };
  put(first.tick, first.t, first.lap, first.llt);
  for (const c of changes ?? []) {
    put(c.ptk, c.ppt, c.pl, c.pllt);
    put(c.tick, c.t, c.lap, c.llt);
    if (c.j) put(c.j.tick, c.j.t, c.lap, c.j.llt);
  }
  const pts = [...at.values()].sort((a, b) => a.tick - b.tick);
  return lapCrossings(
    pts.map(p => p.t),
    pts.map(p => p.lap),
    pts.map(p => p.llt),
  );
}

/**
 * The capture's recordings: one per IsOnTrack stretch, in wall-clock order.
 * Each has `key` (<folder>#<k>, stable as the capture grows), `info`
 * (iracing.mjs describe()'s shape), and `laps`: half-open [t0, t1) parts on the
 * session clock, the first from the stretch start to the first crossing
 * (partial), then crossing to crossing (iracing.mjs lapCrossings); a stretch
 * that has `ended` (another stretch after it, or meta.json endUtc) also lists
 * its trailing part (partial). A lap still being driven is not listed.
 * `lapTimeS`: the sim's time for the lap, null when it gave none (or has not
 * yet: it can come up to 3 s after the crossing) and on partial parts.
 */
export function describeCapture(captureDir) {
  const P = `read_parquet(${playerGlob(captureDir)})`;
  const meta = readMeta(captureDir);
  const [row] = rows(
    ':memory:',
    `WITH r AS (SELECT wall_ms w, tick, SessionTime t, SessionNum sn, Lap lap, LapLastLapTime::DOUBLE llt,
        lag(tick) OVER o ptick, lag(SessionTime) OVER o pt, lag(SessionNum) OVER o psn
        FROM ${P} WINDOW o AS (ORDER BY wall_ms, tick)),
      q AS (SELECT *, sum(${breakSql}) OVER (ORDER BY w, tick) k FROM r),
      span AS (SELECT k, count(*) n, arg_min(t, tick) t0, arg_max(t, tick) t1, min(w) w0, max(w) w1,
        min(tick) tick0, arg_min(lap, tick) lap0, arg_min(llt, tick) llt0 FROM q GROUP BY k),
      ${crossingCtes('q')}
    SELECT to_json({
      stretches: (SELECT list({k: k, n: n, t0: t0, t1: t1, w0: w0, w1: w1, tick0: tick0, lap0: lap0,
        llt0: llt0, cs: cs} ORDER BY k) FROM span LEFT JOIN cross_ USING (k)),
      first: (SELECT to_json(x) FROM ${P} x ORDER BY wall_ms, tick LIMIT 1)
    }) j`,
  );
  const {stretches, first} = JSON.parse(row.j);
  const columns = new Set(Object.keys(first ?? {}));
  const folder = basename(captureDir);
  const list = stretches ?? [];
  return {
    stretches: list.map((st, idx) => {
      const crossings = stretchCrossings(
        {tick: st.tick0, t: st.t0, lap: st.lap0, llt: st.llt0},
        st.cs,
      );
      const laps = [];
      let from = st.t0;
      let lap = st.lap0;
      let partial = true;
      for (const c of crossings) {
        laps.push({
          lapNumber: lap,
          t0: from,
          t1: c.t,
          partial,
          lapTimeS: !partial && c.time > 0 ? c.time : null,
        });
        from = c.t;
        lap = c.lap;
        partial = false;
      }
      const ended = idx < list.length - 1 || Boolean(meta.endUtc);
      const end = st.t1 + END_PAD_S;
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
        startMs: Number(st.w0),
        endMs: Number(st.w1),
        info: stretchInfo(meta, st, columns),
        laps,
      };
    }),
  };
}

// The player's car in meta.json's list (no names of people: ir_session.rs).
function playerCar(meta) {
  const cars = meta.cars ?? [];
  const me =
    cars.find(c => c.isPlayer) ??
    cars.find(c => c.carIdx === meta.playerCarIdx);
  const label = me ? carClasses(cars, []).get(me.carIdx)?.classLabel : '';
  return {
    name: me?.carName || me?.carPath || 'Unknown car',
    carClass: label || me?.className || '',
  };
}

function stretchInfo(meta, st, columns) {
  const sub = String(meta.subSessionId ?? 0);
  const sess = String(meta.sessionNum ?? 0);
  // iracing.mjs describe(): TrackConfigName, else the short TrackName.
  const config = meta.trackConfig || meta.trackShort || '';
  const raw = meta.sessionType || 'Session';
  const car = playerCar(meta);
  const fuel = fuelSetupOf(Number(meta.fuelMaxL), Number(meta.fuelMaxPct));
  return {
    sim: 'iracing',
    source: 'capture',
    // The capture keeps no names of people.
    driver: '',
    recordedAt: new Date(Number(st.w0)).toISOString(),
    sessionClock: `${sub}:${sess}`,
    groupId: sub !== '0' ? `iracing|${sub}|${sess}` : null,
    sessionType: mapSessionType(raw),
    sessionTypeRaw: raw,
    track: meta.track || 'Unknown track',
    layout: `${meta.trackId ?? 0}-${slug(config || meta.track || '')}`,
    layoutName: config || null,
    trackLengthM: meta.trackLengthM > 0 ? meta.trackLengthM : null,
    car: car.name,
    carClass: car.carClass,
    fuelSetup: fuel,
    raceLength: raceLengthOfSessions(meta.sessionNum, meta.sessions),
    weather: meta.trackSkies ?? '',
    // The sectors' starts (SplitTimeInfo) when the recorder kept them.
    sectorStarts: Array.isArray(meta.sectorStarts) ? meta.sectorStarts : [],
    baseHz: HZ,
    ticks: Number(st.n),
    startT: Number(st.t0),
    endT: Number(st.t1),
    channels: CHANNELS.filter(c => columns.has(c.source)).map(c => ({
      source: c.source,
      name: c.name,
      hz: HZ,
      unit: c.unit,
      columns: [c.name],
    })),
    events: [
      {source: 'Lap', name: 'lap', unit: '', width: 1},
      {source: 'LapLastLapTime', name: 'lap_time', unit: 's', width: 1},
      {source: 'OnPitRoad', name: 'in_pits', unit: '', width: 1},
      {source: 'PlayerCarInPitStall', name: 'reset', unit: '', width: 1},
      {source: 'Gear', name: 'gear', unit: '', width: 1},
      {source: 'PlayerTrackSurface', name: 'surface', unit: '', width: 1},
      {source: 'SessionFlags', name: 'yellow_flag', unit: '', width: 1},
    ],
  };
}

/**
 * Write samples.parquet and events.parquet for [t0, t1) of the recording that
 * `info` describes (describeCapture), as iracing.mjs writeArchive() does for an
 * .ibt. `tick` counts the sim's ticks from the recording's first row. Events at
 * the recording's first row carry every state's first value, as the .ibt's
 * do; any later window carries only changes inside it. Two DuckDB runs: the
 * lap crossings (iracing.mjs lapCrossings needs the stretch from its start),
 * then both files.
 */
export function writeCaptureArchive(
  captureDir,
  info,
  {t0, t1},
  samplesOut,
  eventsOut,
) {
  const P = `read_parquet(${playerGlob(captureDir)})`;
  const wall0 = Date.parse(info.recordedAt);
  if (!Number.isFinite(wall0))
    throw new Error(`recording info has no recordedAt: ${info.recordedAt}`);
  const S0 = num(info.startT);
  // This stretch's rows: from its first row on, before the session clock next
  // went back (a stretch never spans that), then by session time.
  const own = `wall_ms >= ${wall0} AND wall_ms < (SELECT coalesce(min(w), 9e18) FROM (
      SELECT wall_ms w, SessionTime t, lag(SessionTime) OVER (ORDER BY wall_ms, tick) pt FROM ${P})
      WHERE t < pt AND w > ${wall0})`;
  const [row] = rows(
    ':memory:',
    `WITH r AS (SELECT wall_ms w, tick, SessionTime t, SessionNum sn, Lap lap, LapLastLapTime::DOUBLE llt,
        lag(tick) OVER o ptick, lag(SessionTime) OVER o pt, lag(SessionNum) OVER o psn
        FROM ${P} WHERE ${own} AND SessionTime >= ${S0} AND SessionTime < ${num(
      t1 + LAP_TIME_WAIT_S + 0.1,
    )}
        WINDOW o AS (ORDER BY wall_ms, tick)),
      q AS (SELECT * FROM (SELECT *, sum(${breakSql}) OVER (ORDER BY w, tick) k FROM r) WHERE k = 0),
      ${crossingCtes('q')}
    SELECT to_json({
      first: (SELECT to_json(x) FROM ${P} x WHERE ${own} ORDER BY wall_ms, tick LIMIT 1),
      cs: (SELECT cs FROM cross_)
    }) j`,
  );
  const out = JSON.parse(row.j);
  const first = out.first;
  if (!first)
    throw new Error(`${basename(captureDir)}: no rows at ${info.recordedAt}`);
  // A FLOAT in JSON is its double value; fround keeps it exact either way.
  const crossings = stretchCrossings(
    {
      tick: first.tick,
      t: first.SessionTime,
      lap: first.Lap,
      llt: Math.fround(first.LapLastLapTime),
    },
    out.cs,
  ).filter(c => c.t >= t0 && c.t < t1);

  const steer = steerScale(
    first.SteeringWheelAngleMax == null
      ? null
      : Math.fround(first.SteeringWheelAngleMax),
  );
  const scaleOf = name => {
    const ch = CHANNELS.find(c => c.name === name);
    return ch.scale === 'steer' ? steer : ch.scale;
  };
  // Every channel scaled as iracing.mjs does (value * scale, in doubles).
  const channels = info.channels.map(
    c => `(${c.source}::DOUBLE * ${num(scaleOf(c.name))})::DOUBLE AS ${c.name}`,
  );
  if (!info.channels.some(c => c.name === 't'))
    throw new Error('recording info has no session clock channel');
  const lapRows = crossings.flatMap(c => [
    `(${num(c.t)}, 'lap', ${num(c.lap)})`,
    ...(c.time > 0 ? [`(${num(c.t)}, 'lap_time', ${num(c.time)})`] : []),
  ]);
  const starts = (info.sectorStarts ?? []).map(Number);
  const sectors =
    starts.length >= 2
      ? `UNION ALL SELECT pt + ((s - ppct) / (pct - ppct)) * (t - pt), 'sector_start', k + 1, ${
          starts.length
        }
        FROM q, (SELECT unnest([${starts.map(num).join(', ')}]) s,
          unnest(range(0, ${starts.length})) k) st
        WHERE k >= 1 AND ppct IS NOT NULL AND pct > ppct AND NOT (pct - ppct > 0.5) AND ppct < s AND s <= pct`
      : '';
  // A state's change: its first row (the recording's start, or no row before
  // in this read, which the window then leaves out) or a new value.
  const change = (col, name) =>
    `UNION ALL SELECT t, '${name}', ${col}, NULL FROM q WHERE p_${col} IS NULL OR ${col} <> p_${col}`;
  const sql = `
SET threads TO 4;
CREATE TEMP TABLE p AS SELECT tick, ${channels.join(', ')},
  Gear::DOUBLE AS gear, (CASE WHEN OnPitRoad THEN 1 ELSE 0 END)::DOUBLE AS pit,
  (CASE WHEN PlayerCarInPitStall THEN 1 ELSE 0 END)::DOUBLE AS stall, FuelLevel::DOUBLE AS fuel,
  (${surfaceSql(
    'PlayerTrackSurface',
    'coalesce(PlayerTrackSurfaceMaterial, 0)',
  )})::DOUBLE AS surf,
  (CASE WHEN (SessionFlags & ${YELLOW}) <> 0 THEN 1 ELSE 0 END)::DOUBLE AS y, LapDistPct::DOUBLE AS pct
  FROM ${P} WHERE ${own} AND SessionTime >= greatest(${S0}, ${num(
    t0 - PAD_S,
  )}) AND SessionTime < ${num(t1)};
CREATE TEMP TABLE q AS SELECT *, lag(t) OVER o AS pt, lag(gear) OVER o AS p_gear, lag(pit) OVER o AS p_pit,
  lag(stall) OVER o AS p_stall, lag(fuel) OVER o AS pfuel, lag(surf) OVER o AS p_surf, lag(y) OVER o AS p_y,
  lag(pct) OVER o AS ppct FROM p WINDOW o AS (ORDER BY tick);
COPY (SELECT (tick - ${first.tick})::BIGINT AS tick, ${info.channels
    .map(c => c.name)
    .join(', ')} FROM q WHERE t >= ${num(t0)} ORDER BY tick)
  TO ${sqlPath(
    samplesOut,
  )} (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 9, ROW_GROUP_SIZE 100000);
COPY (
  SELECT t, name, v1, v2, NULL::DOUBLE AS v3, NULL::DOUBLE AS v4 FROM (
    SELECT NULL::DOUBLE AS t, NULL::VARCHAR AS name, NULL::DOUBLE AS v1, NULL::DOUBLE AS v2 WHERE false
    ${
      lapRows.length
        ? `UNION ALL SELECT col0, col1, col2, NULL FROM (VALUES ${lapRows.join(
            ', ',
          )})`
        : ''
    }
    ${change('pit', 'in_pits')}
    ${change('gear', 'gear')}
    -- iracing.mjs resetTimes: in the stall without the pit road the tick before;
    -- from the tank's refill when it comes up to RESET_LEAD_S earlier.
    UNION ALL SELECT coalesce((SELECT min(x.t) FROM q x WHERE x.tick <= q.tick AND q.t - x.t <= ${RESET_LEAD_S}
        AND x.pfuel IS NOT NULL AND x.fuel - x.pfuel > ${RESET_REFILL_L}), q.t), 'reset', 1, NULL
      FROM q WHERE stall = 1 AND p_stall = 0 AND p_pit = 0
    ${change('surf', 'surface')}
    ${sectors}
    ${change('y', 'yellow_flag')}
  ) e WHERE t >= ${num(t0)} AND t < ${num(t1)} ORDER BY t, name
) TO ${sqlPath(eventsOut)} (FORMAT parquet, COMPRESSION zstd);`;
  run(':memory:', sql);
}
