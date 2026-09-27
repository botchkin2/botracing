// Prototype: run src/analysis/consistency.ts over sessions already written by
// `sync.mjs --local`, pulling per-lap conditions from the archive.
//
//   node tools/sessions/consistency-proto.mjs --work <dir> [--session <id>] [--min 10]
//
// Prints one table per session (with --session) or a summary of every session
// plus how many laps change class when every threshold moves by ±20%.
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {columns, sqlPath} from './duck.mjs';
import {
  analyzeConsistency,
  defaultThresholds,
  normalRacing,
} from '../../src/analysis/consistency.ts';
import {findTrackCorners, segmentTimes} from '../../src/analysis/corners.ts';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const work = resolve(arg('--work', '.'));
const only = arg('--session', '');
const minLaps = Number(arg('--min', '10'));
// --corners track: corners from the track's shape (src/analysis/corners.ts).
// Default: the speed-minima corners analyze.mjs wrote.
const cornerMode = arg('--corners', 'speed');
const GRID_M = 5;

const GREEN = 11;
const flagName = {1: 'sector1_flag', 2: 'sector2_flag', 0: 'sector3_flag'};

function conditions(samplesPath, eventsPath) {
  const perLap = columns(
    ':memory:',
    `WITH laps AS (SELECT t, v1::INT AS lap FROM read_parquet(${sqlPath(eventsPath)}) WHERE name = 'lap')
     SELECT l.lap AS lap, min(l.t) AS t0,
       avg((tyres_carcass_temp_fl + tyres_carcass_temp_fr + tyres_carcass_temp_rl + tyres_carcass_temp_rr) / 4) AS carcass,
       first(fuel_l ORDER BY s.t) AS fuel,
       first(tyres_wear_fl + tyres_wear_fr + tyres_wear_rl + tyres_wear_rr ORDER BY s.t) / 4 AS wear
     FROM read_parquet(${sqlPath(samplesPath)}) s ASOF JOIN laps l ON s.t >= l.t
     GROUP BY l.lap ORDER BY l.lap`,
  );
  const ev = columns(
    ':memory:',
    `SELECT list_position(['lap','yellow_flag','current_sector','sector1_flag','sector2_flag','sector3_flag'], name) - 1 AS k, t, v1
     FROM read_parquet(${sqlPath(eventsPath)})
     WHERE name IN ('lap','yellow_flag','current_sector','sector1_flag','sector2_flag','sector3_flag') ORDER BY t`,
  );
  const names = ['lap', 'yellow_flag', 'current_sector', 'sector1_flag', 'sector2_flag', 'sector3_flag'];
  // Intervals with a local yellow in the sector the car is in, and with a
  // full-course yellow.
  const local = [];
  const course = [];
  const state = {sector1_flag: GREEN, sector2_flag: GREEN, sector3_flag: GREEN};
  let sector = 1;
  let localOpen = null;
  let courseOpen = null;
  for (let i = 0; i < ev.k.length; i++) {
    const name = names[ev.k[i]];
    const t = ev.t[i];
    const v = ev.v1[i];
    if (name === 'yellow_flag') {
      if (v > 0 && courseOpen == null) courseOpen = t;
      if (v === 0 && courseOpen != null) {
        course.push([courseOpen, t]);
        courseOpen = null;
      }
      continue;
    }
    if (name === 'current_sector') sector = v;
    else if (name in state) state[name] = v;
    else continue;
    const yellow = state[flagName[sector]] !== GREEN;
    if (yellow && localOpen == null) localOpen = t;
    if (!yellow && localOpen != null) {
      local.push([localOpen, t]);
      localOpen = null;
    }
  }
  if (localOpen != null) local.push([localOpen, Infinity]);
  if (courseOpen != null) course.push([courseOpen, Infinity]);
  const byLap = new Map();
  for (let i = 0; i < perLap.lap.length; i++) {
    byLap.set(perLap.lap[i], {
      t0: perLap.t0[i],
      carcass: perLap.carcass[i],
      fuel: perLap.fuel[i],
      wear: perLap.wear[i],
    });
  }
  return {byLap, local, course};
}

function overlap(intervals, a, b) {
  let total = 0;
  for (const [x, y] of intervals) total += Math.max(0, Math.min(b, y) - Math.max(a, x));
  return total;
}

// Time into the lap at which the trace reaches each corner boundary.
function cornerWindows(tracePath, lengthM, corners) {
  const rows = readFileSync(tracePath, 'utf8').split('\n');
  const dist = [];
  for (let i = 1; i < rows.length; i++) {
    const c = rows[i].split(',');
    dist.push(Number(c[1]) * lengthM);
  }
  const timeAt = m => {
    const i = dist.findIndex(d => d >= m);
    return (i < 0 ? dist.length : i) / 100;
  };
  return corners.map(c => [timeAt(c.startM), timeAt(c.endM)]);
}

function readTrace(path, lengthM) {
  const rows = readFileSync(path, 'utf8').trim().split('\n');
  const n = rows.length - 1;
  const tr = {dist: new Float64Array(n), speed: new Float64Array(n), brake: new Float64Array(n), throttle: new Float64Array(n), lat: new Float64Array(n), lon: new Float64Array(n)};
  for (let i = 0; i < n; i++) {
    const c = rows[i + 1].split(',');
    tr.speed[i] = Number(c[0]) * 3.6;
    tr.dist[i] = Number(c[1]) * lengthM;
    tr.lat[i] = Number(c[2]);
    tr.lon[i] = Number(c[3]);
    tr.brake[i] = Number(c[4]);
    tr.throttle[i] = Number(c[5]);
  }
  // Rows are at the recording's base rate, 100 Hz.
  tr.timeAt = m => {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tr.dist[mid] < m) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return 0;
    const d0 = tr.dist[lo - 1];
    const d1 = tr.dist[lo];
    return (lo - 1 + (d1 > d0 ? Math.min(1, (m - d0) / (d1 - d0)) : 0)) / 100;
  };
  return tr;
}

// Median lap on a grid, over laps of about the same length.
function profileOf(traces, lengthM) {
  const n = Math.floor(lengthM / GRID_M);
  const R = 6371000;
  const lat0 = traces[0].lat.find(v => v !== 0) ?? 0;
  const cos0 = Math.cos((lat0 * Math.PI) / 180);
  const keys = ['speedKmh', 'brake', 'throttle', 'x', 'y'];
  const cols = {speedKmh: 'speed', brake: 'brake', throttle: 'throttle', x: 'lon', y: 'lat'};
  const out = {stepM: GRID_M};
  for (const key of keys) out[key] = new Array(n);
  const sampled = traces.map(tr => {
    const row = {};
    for (const key of keys) row[key] = new Float64Array(n);
    let j = 0;
    for (let g = 0; g < n; g++) {
      const m = g * GRID_M;
      while (j < tr.dist.length - 2 && tr.dist[j + 1] < m) j++;
      for (const key of keys) row[key][g] = tr[cols[key]][j];
    }
    row.x = row.x.map(v => ((v * Math.PI) / 180) * R * cos0);
    row.y = row.y.map(v => ((v * Math.PI) / 180) * R);
    return row;
  });
  for (let g = 0; g < n; g++) {
    for (const key of keys) {
      const v = sampled.map(r => r[key][g]).sort((a, b) => a - b);
      out[key][g] = v[v.length >> 1];
    }
  }
  return out;
}

function loadSession(dir) {
  const session = JSON.parse(readFileSync(resolve(dir, 'session.json'), 'utf8'));
  const laps = JSON.parse(readFileSync(resolve(dir, 'laps.json'), 'utf8'));
  const recs = JSON.parse(readFileSync(resolve(dir, 'recordings.json'), 'utf8'));
  const cond = new Map();
  for (const rec of recs) {
    const base = resolve(work, 'archive', session.id, rec.id);
    if (!existsSync(`${base}.samples.parquet`)) continue;
    cond.set(rec.id, conditions(`${base}.samples.parquet`, `${base}.events.parquet`));
  }
  let trackCorners = null;
  let profileLength = 0;
  const traces = new Map();
  if (cornerMode === 'track') {
    for (const lap of laps) {
      const path = resolve(dir, 'traces', `${lap.id}.csv`);
      if (lap.distanceM && existsSync(path)) traces.set(lap.id, readTrace(path, lap.distanceM));
    }
    const lengths = laps.filter(l => l.comparable).map(l => l.distanceM).sort((a, b) => a - b);
    profileLength = lengths[lengths.length >> 1];
    const clean = laps.filter(l => l.comparable && traces.has(l.id) && Math.abs(l.distanceM - profileLength) < profileLength * 0.01);
    if (clean.length >= 3) trackCorners = findTrackCorners(profileOf(clean.map(l => traces.get(l.id)), profileLength));
  }
  const stintStart = new Map();
  let lastWear = null;
  const facts = laps.map(lap => {
    if (!stintStart.has(lap.stint)) stintStart.set(lap.stint, laps.indexOf(lap));
    const c = cond.get(lap.recordingId);
    const at = c?.byLap.get(lap.lapNumber);
    const t0 = at?.t0;
    let corners = null;
    const trace = resolve(dir, 'traces', `${lap.id}.csv`);
    if (trackCorners && traces.has(lap.id) && !lap.partial) {
      const tr = traces.get(lap.id);
      const scale = lap.distanceM / profileLength;
      const scaledCorners = trackCorners.map(tc => ({...tc, entryM: tc.entryM * scale}));
      const seg = segmentTimes(scaledCorners, lap.distanceM, tr.timeAt);
      corners = seg.map((segTime, k) => {
        const a = tr.timeAt(scaledCorners[k].entryM);
        return {
          segTime,
          localYellowSec: c && t0 != null ? overlap(c.local, t0 + a, t0 + a + segTime) : 0,
        };
      });
    } else if (trackCorners) {
      corners = null;
    } else if (lap.corners && session.corners && existsSync(trace) && t0 != null) {
      const windows = cornerWindows(trace, lap.distanceM, session.corners);
      corners = lap.corners.map((cm, k) => ({
        segTime: cm.segTime,
        localYellowSec: overlap(c.local, t0 + windows[k][0], t0 + windows[k][1]),
      }));
    } else if (lap.corners) {
      corners = lap.corners.map(cm => ({segTime: cm.segTime, localYellowSec: 0}));
    }
    function newTyres(wear) {
      // Fresh tyres: average wear jumps up from the lap before.
      const jumped = wear != null && lastWear != null && wear > lastWear + 1;
      if (wear != null) lastWear = wear;
      return jumped;
    }
    return {
      id: lap.id,
      lapNumber: lap.lapNumber,
      stint: lap.stint,
      stintLap: laps.indexOf(lap) - stintStart.get(lap.stint),
      lapTime: lap.lapTime,
      timed: lap.timed,
      partial: lap.partial,
      pitIn: lap.pitIn,
      pitOut: lap.pitOut,
      start: laps.indexOf(lap) === 0 && !lap.pitOut,
      newTyres: newTyres(at?.wear),
      offtrack: lap.offtrack,
      impactMax: lap.impactMax || 0,
      tyreCarcassC: at?.carcass ?? null,
      courseYellowSec: t0 != null ? overlap(c.course, t0, t0 + lap.durationSec) : 0,
      corners,
      fuel: at?.fuel ?? null,
    };
  });
  return {session, facts, trackCorners};
}

function run(facts, thresholds) {
  const reasons = normalRacing(facts, thresholds);
  const selected = facts.filter(f => reasons.get(f.id).length === 0);
  return {reasons, result: analyzeConsistency(selected, thresholds)};
}

const scaled = k => {
  const t = {...defaultThresholds};
  const keys = process.env.SENS_KEYS?.split(',') ?? ['slowLapZ', 'slowLapMinSec', 'cornerZ', 'cornerMinSec', 'bleedZ', 'mistakeShare', 'bigMistakeSec'];
  for (const key of keys) {
    t[key] *= k;
  }
  return t;
};

const outDir = resolve(work, 'out');
const ids = only ? [only] : readdirSync(outDir);
let totalLaps = 0;
let changed = 0;
// Does a local yellow slow the corner? Corner deltas with and without one.
const yel = {y: [], n: []};
for (const id of ids) {
  const dir = resolve(outDir, id);
  let loaded;
  try {
    const s = JSON.parse(readFileSync(resolve(dir, 'session.json'), 'utf8'));
    if (!only && s.comparableCount < minLaps) continue;
    loaded = loadSession(dir);
  } catch (e) {
    console.error(id, e.message);
    continue;
  }
  const {session, facts, trackCorners} = loaded;
  const {reasons, result} = run(facts, defaultThresholds);
  const kinds = new Map(result.laps.map(r => [r.id, r.kind]));
  for (const k of [0.8, 1.2]) {
    const other = run(facts, scaled(k)).result;
    for (const r of other.laps) if (kinds.get(r.id) !== r.kind) changed++;
    totalLaps += result.laps.length;
  }
  for (const r of result.laps) {
    const f = facts.find(x => x.id === r.id);
    r.cornerDelta?.forEach((d, k) =>
      (f.corners[k].localYellowSec >= 0.5 ? yel.y : yel.n).push(d),
    );
  }
  const s = result.summary;
  if (only) {
    for (const f of facts) {
      const r = result.laps.find(x => x.id === f.id);
      const why = reasons.get(f.id).join('+');
      const yellow = f.corners?.map(c => (c.localYellowSec >= 0.5 ? 'Y' : '.')).join('') ?? '';
      console.log(
        [
          String(f.lapNumber).padStart(3),
          f.stint,
          f.lapTime.toFixed(3).padStart(8),
          (f.tyreCarcassC ?? 0).toFixed(0).padStart(3) + 'C',
          (f.fuel ?? 0).toFixed(0).padStart(3) + 'L',
          r ? `${r.residual >= 0 ? '+' : ''}${r.residual.toFixed(2)}`.padStart(6) : '      ',
          (r ? r.kind + (r.corner ? ` C${r.corner}` : '') + (r.cost ? ` ${r.cost.toFixed(2)}s` : '') : `out: ${why}`).padEnd(24),
          yellow,
          r?.events.map(e => `C${e.corner}${e.seconds > 0 ? '+' : ''}${e.seconds}${e.underYellow ? 'Y' : ''}`).join(' ') ?? '',
          f.offtrack ? 'off' : '',
        ].join(' '),
      );
    }
    if (trackCorners) {
      for (const tc of trackCorners) console.log(`  corner ${tc.n} ${tc.direction.padEnd(5)} entry ${tc.entryM} turn-in ${tc.turnInM} apex ${tc.apexM} exit ${tc.exitM} min ${tc.minSpeedKmh} km/h${tc.flat ? ' flat' : ''}`);
    }
    console.log(JSON.stringify(result.stints));
    console.log(JSON.stringify(result.corners));
    console.log(JSON.stringify(s));
    console.log(result.verdict);
  } else {
    console.log(
      [
        id,
        session.startedAt?.slice(0, 10),
        session.sessionType.padEnd(8),
        (session.track?.name ?? '').slice(0, 18).padEnd(18),
        `n=${s.laps}`,
        `raw=${s.rawSpread}`,
        `scatter=${s.scatter}`,
        `mist=${s.mistakes}/${s.mistakeCost}s`,
        `spread=${s.spreadLaps}`,
        `out=${facts.length - s.laps}`,
        `trend=${result.stints.map(st => st.trendPerLap).join('/')}`,
      ].join(' '),
    );
  }
}
if (!only) {
  const describe = v => {
    const a = [...v].sort((p, q) => p - q);
    const at = q => a[Math.floor((a.length - 1) * q)].toFixed(3);
    return `n=${v.length} mean=${(v.reduce((p, q) => p + q, 0) / v.length).toFixed(3)} median=${at(0.5)} p90=${at(0.9)} lost>0.1s=${(v.filter(x => x > 0.1).length / v.length).toFixed(3)}`;
  };
  console.log(`corner delta, local yellow: ${describe(yel.y)}`);
  console.log(`corner delta, green:        ${describe(yel.n)}`);
  console.log(
    `threshold ±20%: ${changed} of ${totalLaps} lap classifications change (${((100 * changed) / Math.max(1, totalLaps)).toFixed(1)}%)`,
  );
}
