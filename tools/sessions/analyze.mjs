// Session analysis, computed once at upload so the app never crunches a race.
//
// Input is our own archive (samples.parquet + events.parquet per recording),
// so this file knows nothing about any one sim.
//
// Output per session:
//   laps        every start/finish segment, with stint, pit in/out, off-track
//               time, impacts, sectors, and the reasons it is not comparable.
//   corners     the track's corners (src/analysis/corners.ts): passed in when
//               the track already has a map, else found on this session.
//   per lap     per-corner segment time (brake to brake), min speed, brake
//               point, full throttle, off-track and local-yellow time, and the
//               conditions the lap was driven in (stint lap, tyre temperature,
//               fresh tyres, full-course yellow).
//   consistency pace trend, scatter, and where each off-pace lap lost its
//               time, over the "normal racing" laps (src/analysis/consistency.ts,
//               the same code the app runs on a selection).
//   band        median and p10/p90 of speed, throttle, brake on a 5 m grid,
//               over the comparable laps.
//   traces      one CSV per lap in the format the app already draws.
import {columns, sqlPath} from './duck.mjs';
import {
  analyzeConsistency,
  selectNormalRacing,
} from '../../src/analysis/consistency.ts';
import {findTrackSections} from '../../src/analysis/corners.ts';
import {fileChange} from './fileChange.mjs';
import {
  fillLapsLeft,
  lapFuel,
  neverLeavesZero,
  lapPitStop,
  litresPerVePct,
  markGreen,
  stintFuel,
} from './fuelFacts.mjs';
import {brakeStart, fullThrottleStart, sampleTicks} from './pedalPoints.mjs';

// 9: the trace CSV gains PathLateral and TrackEdge (Corner's racing-line chart).
// 10: fuel and Virtual Energy per lap, pit stop and stint (fuelFacts.mjs).
// 11: litres per 1 % VE on the session's fuel block.
// 13: per-corner slices of every lap's trace (cornerSlices.mjs).
// 14: the slices reach 350 m before the apex, for the braking map.
// 15: per-wheel tyre changes on each pit stop (#165).
// 16: forces a resync after the describe cache learned versions: files described
//     before #144 kept their old fuel setup (an LMP2 fill limit of 1980 L).
export const analysisVersion = 16;

const GRID_M = 5;
const SLOW_SIGMAS = 3;
const SLOW_MIN_SEC = 1.5;
const SLOW_MAX_FACTOR = 1.07;
const OFF_TRACK_SEC = 0.2;
// A track's stored corner map is built only from a session with at least
// this many clean laps of the same length.
const MAP_MIN_LAPS = 8;
// The shape of a stored corner map. A map from an older version (before
// sections, say) is rebuilt by the next session with enough clean laps,
// instead of being reused forever.
export const trackMapVersion = 4;

// Channels the analysis reads, by neutral name. Missing ones are skipped.
const wanted = [
  't',
  'speed_kmh',
  'throttle_pct',
  'brake_pct',
  'steer_pct',
  'rpm',
  'lap_dist_m',
  'lat_deg',
  'lon_deg',
  'path_lateral_m',
  'track_edge_m',
  // Fuel in litres and Virtual Energy in %, 20 Hz (fuelFacts.mjs).
  'fuel_l',
  'virtual_energy_pct',
  // Not neutral names yet: LMU's. Another sim without them gets no tyre
  // conditions, and the cold-tyre rule simply does not fire.
  // The driver's pedal before the car's electronics; see pedalPoints.mjs.
  'throttle_pos_unfiltered',
  'tyres_carcass_temp_fl',
  'tyres_carcass_temp_fr',
  'tyres_carcass_temp_rl',
  'tyres_carcass_temp_rr',
  'tyres_wear_fl',
  'tyres_wear_fr',
  'tyres_wear_rl',
  'tyres_wear_rr',
];

const LOOSE_SURFACES = new Set([2, 3, 4]);

export function loadRecording(recording, samplesPath, eventsPath) {
  const hzByColumn = {};
  for (const channel of recording.channels) {
    for (const column of channel.columns) hzByColumn[column] = channel.hz;
  }
  const present = wanted.filter(name => name === 't' || hzByColumn[name]);
  const raw = columns(
    ':memory:',
    `SELECT ${present.join(', ')} FROM read_parquet(${sqlPath(
      samplesPath,
    )}) ORDER BY tick`,
  );
  const base = recording.baseHz;
  const s = {};
  for (const name of present) {
    const hz = hzByColumn[name] || base;
    s[name] =
      hz < base
        ? interpolateHeld(raw[name], hz, base, name === 'lap_dist_m')
        : raw[name];
  }
  // A channel flat at 0 (an LMP2's Virtual Energy) means the car has none.
  if (neverLeavesZero(s.virtual_energy_pct)) delete s.virtual_energy_pct;
  // Event names travel as their index in eventKinds, so every column is numeric.
  const ev = columns(
    ':memory:',
    `SELECT list_position([${eventKinds
      .map(k => `'${k}'`)
      .join(',')}], name) - 1 AS k, ` +
      `t, v1, v2, v3, v4 FROM read_parquet(${sqlPath(eventsPath)}) ` +
      `WHERE name IN (${eventKinds.map(k => `'${k}'`).join(',')}) ORDER BY t`,
  );
  const events = {};
  for (let i = 0; i < ev.k.length; i++) {
    (events[eventKinds[ev.k[i]]] ||= []).push({
      t: ev.t[i],
      v: ev.v1[i],
      v2: ev.v2[i],
      v3: ev.v3[i],
      v4: ev.v4[i],
    });
  }
  // Each channel's logged rate, so analysis can read real samples only.
  const hz = Object.fromEntries(
    Object.keys(s).map(n => [n, hzByColumn[n] || base]),
  );
  return {recording, s, hz, baseHz: base, events, ticks: s.t.length};
}

const eventKinds = [
  'lap',
  'lap_time',
  'in_pits',
  'gear',
  'surface',
  'impact',
  'sector1_time',
  'sector2_through_time',
  'yellow_flag',
  'current_sector',
  'sector1_flag',
  'sector2_flag',
  'sector3_flag',
  'tyres_compound',
  'minimum_path_wetness',
];

// A slower channel is stored held at the base rate. Its real sample k starts
// at tick ceil(k * base / hz). Draw straight lines between real samples.
// Lap distance resets at the line; never draw a line across that drop.
function interpolateHeld(values, hz, base, resets) {
  const out = new Float64Array(values.length);
  const step = base / hz;
  let k = 0;
  for (;;) {
    const i0 = Math.ceil(k * step);
    if (i0 >= values.length) break;
    const i1 = Math.min(Math.ceil((k + 1) * step), values.length - 1);
    const v0 = values[i0];
    const v1 = resets && values[i1] < values[i0] ? values[i0] : values[i1];
    const span = i1 - i0 || 1;
    for (let i = i0; i <= i1 && i < values.length; i++) {
      out[i] = v0 + ((v1 - v0) * (i - i0)) / span;
    }
    if (i1 === values.length - 1) break;
    k++;
  }
  return out;
}

function idxAt(times, t) {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function round(value, digits) {
  if (value == null || !Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function median(values) {
  return quantile(values, 0.5);
}

function quantile(values, q) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function stdev(values) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1));
}

function pitIntervals(list) {
  const out = [];
  let open = null;
  for (const event of list || []) {
    if (event.v === 1 && open == null) open = event.t;
    if (event.v === 0 && open != null) {
      out.push([open, event.t]);
      open = null;
    }
  }
  if (open != null) out.push([open, Infinity]);
  return out;
}

function lapTimeNear(list, t) {
  let best = null;
  let bestDt = 0.75;
  for (const event of list || []) {
    const dt = Math.abs(event.t - t);
    if (dt < bestDt) {
      bestDt = dt;
      best = event.v;
    }
  }
  return best != null && best > 0 ? best : null;
}

function lastPositive(list, start, end) {
  let value = null;
  for (const event of list || []) {
    if (event.t < start - 0.2) continue;
    if (event.t > end + 0.75) break;
    if (event.v > 1) value = event.v;
  }
  return value;
}

function sectorTimes(events, start, end, lapTime) {
  if (lapTime == null) return [];
  const s1 = lastPositive(events.sector1_time, start, end);
  const through2 = lastPositive(events.sector2_through_time, start, end);
  if (s1 == null || through2 == null) return [];
  const s2 = through2 - s1;
  const s3 = lapTime - through2;
  if (s2 <= 0.5 || s3 <= 0.5) return [];
  return [round(s1, 3), round(s2, 3), round(s3, 3)];
}

function isLoose(event) {
  if (!event) return false;
  return [event.v, event.v2, event.v3, event.v4].some(v =>
    LOOSE_SURFACES.has(v),
  );
}

// Start/finish segments of one recording, as tick ranges.
function segments(rec) {
  const {s, events} = rec;
  const t = s.t;
  const tStart = t[0];
  const tEnd = t[t.length - 1];
  const laps = (events.lap || []).filter(e => e.t >= tStart - 0.5);
  const out = [];
  if (laps.length === 0) {
    out.push({start: tStart, end: tEnd, lapNumber: 1, partial: true});
    return out;
  }
  if (laps[0].t - tStart > 1) {
    out.push({
      start: tStart,
      end: laps[0].t,
      lapNumber: laps[0].v,
      partial: true,
    });
  }
  for (let i = 0; i < laps.length; i++) {
    const start = laps[i].t;
    const end = i + 1 < laps.length ? laps[i + 1].t : tEnd;
    if (end - start < 0.5) continue;
    out.push({
      start,
      end,
      lapNumber: laps[i].v,
      partial: i === laps.length - 1,
    });
  }
  return out;
}

// Ticks of one lap, trimmed where lap distance resets at the line.
function lapTicks(rec, seg) {
  const {s} = rec;
  let i0 = idxAt(s.t, seg.start);
  let i1 = Math.min(idxAt(s.t, seg.end), s.t.length - 1);
  const d = s.lap_dist_m;
  if (d) {
    // The beacon fires while distance still shows the previous lap's total.
    for (let i = i0 + 1; i <= Math.min(i1, i0 + 500); i++) {
      if (d[i - 1] - d[i] > 150) {
        i0 = i;
        break;
      }
    }
    for (let i = i0 + 1; i <= i1; i++) {
      if (d[i - 1] - d[i] > 150) {
        i1 = i - 1;
        break;
      }
    }
  }
  return [i0, i1];
}

// Distance along the lap for each tick: lap_dist when the sim gives it,
// else integrated speed. Forced to never go backwards.
function lapDistance(rec, i0, i1) {
  const {s} = rec;
  const out = new Float64Array(i1 - i0 + 1);
  if (s.lap_dist_m) {
    let prev = 0;
    for (let i = i0; i <= i1; i++) {
      const v = Math.max(prev, s.lap_dist_m[i]);
      out[i - i0] = v;
      prev = v;
    }
    return out;
  }
  for (let i = i0 + 1; i <= i1; i++) {
    const dt = s.t[i] - s.t[i - 1];
    out[i - i0] = out[i - i0 - 1] + (s.speed_kmh[i] / 3.6) * Math.max(0, dt);
  }
  return out;
}

function analyzeLap(rec, seg, pits, flags) {
  const {s, events} = rec;
  const [i0, i1] = lapTicks(rec, seg);
  const dist = lapDistance(rec, i0, i1);
  const gameLapTime = lapTimeNear(events.lap_time, seg.end);
  const timed = gameLapTime != null;

  let offTicks = 0;
  let edgeTicks = 0;
  let surfI = -1;
  const surface = events.surface || [];
  while (surfI + 1 < surface.length && surface[surfI + 1].t <= s.t[i0]) surfI++;
  const off = new Uint8Array(i1 - i0 + 1);
  for (let i = i0; i <= i1; i++) {
    let crossed = false;
    while (surfI + 1 < surface.length && surface[surfI + 1].t <= s.t[i]) {
      surfI++;
      if (isLoose(surface[surfI])) crossed = true;
    }
    const isOff = crossed || (surfI >= 0 && isLoose(surface[surfI]));
    off[i - i0] = isOff ? 1 : 0;
    if (isOff) offTicks++;
    if (s.path_lateral_m && s.track_edge_m) {
      if (Math.abs(s.path_lateral_m[i]) > Math.abs(s.track_edge_m[i]) + 0.25)
        edgeTicks++;
    }
  }
  const tickSec = (s.t[i1] - s.t[i0]) / Math.max(1, i1 - i0);

  let impactMax = 0;
  for (const event of events.impact || []) {
    if (event.t >= seg.start && event.t < seg.end && event.v > impactMax)
      impactMax = event.v;
  }

  // Conditions the lap was driven in.
  const carcass = mean4(s, 'tyres_carcass_temp', i0, i1);
  const compoundAt = valueAt(events.tyres_compound, seg.start + 1);
  const wetness = maxIn(events.minimum_path_wetness, seg.start, seg.end);
  const wearStart = mean4(s, 'tyres_wear', i0, i0);

  // In: entered the pits during this lap. Out: left them during this lap.
  // A box before the timing line makes one lap both.
  const pitIn = pits.some(([a]) => a > seg.start && a <= seg.end);
  const pitOut = pits.some(([, b]) => b >= seg.start && b < seg.end);
  const pitlane = pits.some(([a, b]) => a < seg.end && b > seg.start);

  return {
    lapNumber: seg.lapNumber,
    startT: s.t[i0],
    endT: s.t[i1],
    i0,
    i1,
    dist,
    off,
    durationSec: round(seg.end - seg.start, 3),
    gameLapTime: timed ? round(gameLapTime, 3) : null,
    lapTime: round(timed ? gameLapTime : seg.end - seg.start, 3),
    timed,
    partial: seg.partial,
    pitlane,
    pitIn,
    pitOut,
    offTrackSec: round(offTicks * tickSec, 2),
    pastEdgeSec: round(edgeTicks * tickSec, 2),
    offtrack: offTicks * tickSec >= OFF_TRACK_SEC,
    impactMax: round(impactMax, 1),
    tyreCarcassC: round(carcass, 1),
    wearStart,
    courseYellowSec: round(overlap(flags.course, seg.start, seg.end), 2),
    compound: compoundAt
      ? `${compoundAt.v}/${compoundAt.v2 ?? compoundAt.v}`
      : null,
    wetness: wetness == null ? null : round(wetness, 1),
    sectors: sectorTimes(
      events,
      seg.start,
      seg.end,
      timed ? gameLapTime : null,
    ),
    // Fuel and VE used on the lap (added back across a pit stop), and the
    // stop entered during it; null when the recording has no such channel.
    // Read over the lap's whole time window, not its trimmed ticks (which
    // stop where the lap distance resets, often at the pit entry), so
    // consecutive laps tile with no fuel unaccounted for.
    fuel: lapFuel(
      s,
      idxAt(s.t, seg.start),
      Math.min(idxAt(s.t, seg.end), s.t.length - 1),
      pits,
    ),
    pitStop: lapPitStop(s, seg.start, seg.end, pits),
    distanceM: round(dist[dist.length - 1], 1),
    ...topSpeed(s, i0, i1, dist),
  };
}

// The fastest recorded speed sample of the lap (100 Hz, every tick real) and
// where it was, not a value off the 5 m grid.
export function topSpeed(s, i0, i1, dist) {
  let top = i0;
  for (let i = i0; i <= i1; i++) {
    if (s.speed_kmh[i] > s.speed_kmh[top]) top = i;
  }
  return {
    maxSpeedKmh: round(s.speed_kmh[top], 1),
    maxSpeedAtM: round(dist[top - i0], 1),
  };
}

// Resample one lap onto the distance grid: time, speed, throttle, brake.
function onGrid(rec, lap, gridN) {
  const {s} = rec;
  const out = {
    time: new Float64Array(gridN),
    speed: new Float64Array(gridN),
    throttle: new Float64Array(gridN),
    brake: new Float64Array(gridN),
    lat: new Float64Array(gridN),
    lon: new Float64Array(gridN),
  };
  let j = 0;
  const n = lap.dist.length;
  for (let g = 0; g < gridN; g++) {
    const target = g * GRID_M;
    while (j < n - 2 && lap.dist[j + 1] < target) j++;
    const d0 = lap.dist[j];
    const d1 = lap.dist[j + 1] ?? d0;
    const mix =
      d1 > d0 ? Math.min(1, Math.max(0, (target - d0) / (d1 - d0))) : 0;
    const a = lap.i0 + j;
    const b = Math.min(a + 1, lap.i1);
    const lerp = arr => (arr ? arr[a] + (arr[b] - arr[a]) * mix : NaN);
    out.time[g] = lerp(s.t) - s.t[lap.i0];
    out.speed[g] = lerp(s.speed_kmh);
    out.throttle[g] = lerp(s.throttle_pct);
    out.brake[g] = lerp(s.brake_pct);
    out.lat[g] = lerp(s.lat_deg);
    out.lon[g] = lerp(s.lon_deg);
  }
  return out;
}

// Mean of the four tyres' channel over ticks i0..i1, or null.
function mean4(s, prefix, i0, i1) {
  const cols = ['fl', 'fr', 'rl', 'rr'].map(w => s[`${prefix}_${w}`]);
  if (cols.some(c => !c)) return null;
  let total = 0;
  let n = 0;
  for (let i = i0; i <= i1; i++) {
    for (const c of cols) total += c[i];
    n += 4;
  }
  return n ? total / n : null;
}

// The last event at or before t.
function valueAt(list, t) {
  let found = null;
  for (const e of list || []) {
    if (e.t > t) break;
    found = e;
  }
  return found;
}

// The highest value in force at any time in [a, b].
function maxIn(list, a, b) {
  if (!list?.length) return null;
  let max = valueAt(list, a)?.v ?? null;
  for (const e of list) {
    if (e.t > b) break;
    if (e.t >= a && (max == null || e.v > max)) max = e.v;
  }
  return max;
}

function overlap(intervals, a, b) {
  let total = 0;
  for (const [x, y] of intervals) {
    total += Math.max(0, Math.min(b, y) - Math.max(a, x));
  }
  return total;
}

// Full-course yellow, and a local yellow in the sector the car is in.
// Sector flags: 11 is green. current_sector: 1, 2, then 0 for the last.
const GREEN = 11;
const sectorFlag = {1: 'sector1_flag', 2: 'sector2_flag', 0: 'sector3_flag'};
function flagIntervals(events) {
  const course = [];
  let open = null;
  for (const e of events.yellow_flag || []) {
    if (e.v > 0 && open == null) open = e.t;
    if (e.v === 0 && open != null) {
      course.push([open, e.t]);
      open = null;
    }
  }
  if (open != null) course.push([open, Infinity]);
  const merged = [
    'current_sector',
    'sector1_flag',
    'sector2_flag',
    'sector3_flag',
  ]
    .flatMap(name => (events[name] || []).map(e => ({...e, name})))
    .sort((a, b) => a.t - b.t);
  const state = {
    sector1_flag: GREEN,
    sector2_flag: GREEN,
    sector3_flag: GREEN,
  };
  let sector = 1;
  const local = [];
  open = null;
  for (const e of merged) {
    if (e.name === 'current_sector') sector = e.v;
    else state[e.name] = e.v;
    const yellow = state[sectorFlag[sector]] !== GREEN;
    if (yellow && open == null) open = e.t;
    if (!yellow && open != null) {
      local.push([open, e.t]);
      open = null;
    }
  }
  if (open != null) local.push([open, Infinity]);
  return {course, local};
}

// Median lap on the grid for finding corners, position in metres.
function profile(laps, gridN) {
  const R = 6371000;
  const lat0 = laps[0].grid.lat.find(v => v !== 0) || 0;
  const cos0 = Math.cos((lat0 * Math.PI) / 180);
  const med = pick =>
    Array.from({length: gridN}, (_, g) =>
      median(laps.map(l => pick(l.grid, g))),
    );
  return {
    stepM: GRID_M,
    speedKmh: med((grid, g) => grid.speed[g]),
    brake: med((grid, g) => grid.brake[g] / 100),
    throttle: med((grid, g) => grid.throttle[g] / 100),
    x: med((grid, g) => ((grid.lon[g] * Math.PI) / 180) * R * cos0),
    y: med((grid, g) => ((grid.lat[g] * Math.PI) / 180) * R),
  };
}

// A lap's distance must start at the line and cover the mapped lap, or its
// corner split is wrong (a start from the grid, a reset, a distance glitch).
const LINE_M = 30;
const LENGTH_TOLERANCE = 0.02;

function cornersFit(lap, map) {
  return (
    lap.grid &&
    lap.dist[0] <= LINE_M &&
    Math.abs(lap.distanceM - map.lengthM) <= map.lengthM * LENGTH_TOLERANCE
  );
}

// One lap through the track's corners: segment times brake to brake, and
// what happened in each. Everything stays inside this lap, so its segments
// add up to its lap time: the last segment is this lap's last entry to the
// line plus its own run from the line to corner 1's entry.
function cornerFacts(rec, lap, corners, flags) {
  const {grid} = lap;
  const {s} = rec;
  const n = grid.time.length;
  const at = m => Math.min(n - 1, Math.max(0, Math.round(m / GRID_M)));
  // The first tick at or past a distance, and a tick's distance.
  const tickAt = m => {
    let lo = 0;
    let hi = lap.dist.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lap.dist[mid] < m) lo = mid + 1;
      else hi = mid;
    }
    return lap.i0 + lo;
  };
  const distAt = i => lap.dist[i - lap.i0];
  const entries = corners.map(c => at(c.entryM));
  const firstEntryM = corners[0].entryM;
  const facts = corners.map((c, k) => {
    const e0 = entries[k];
    const e1 = k + 1 < corners.length ? entries[k + 1] : null;
    const last = e1 == null;
    const segTime = last
      ? lap.lapTime - grid.time[e0] + grid.time[entries[0]]
      : grid.time[e1] - grid.time[e0];
    // The slowest recorded sample between turn-in and exit (speed is logged
    // at 100 Hz, every tick), at its own distance; then the brake point
    // before it and the first full throttle after it, before the next corner.
    const turnInTick = tickAt(c.turnInM);
    const exitTick = tickAt(c.exitM);
    let minTick = turnInTick;
    for (let i = turnInTick; i <= exitTick; i++) {
      if (s.speed_kmh[i] < s.speed_kmh[minTick]) minTick = i;
    }
    // Slowest on the window's edge: the car was still slowing at turn-in or
    // already slower at the exit, so the minimum is the boundary's, not the
    // corner's (pitlane #645). The speed at the map's apex is the corner fact
    // that holds either way.
    const minAtEdge = minTick - turnInTick <= 1 || exitTick - minTick <= 1;
    const apexTick = tickAt(c.apexM);
    // Brake and full-throttle points from the real pedal samples.
    const nextTick = e1 == null ? lap.i1 : tickAt(e1 * GRID_M);
    const entryTick = tickAt(e0 * GRID_M);
    const brake = brakeStart(
      s.brake_pct,
      sampleTicks(rec.hz.brake_pct, rec.baseHz, lap.i0, exitTick),
      distAt,
      entryTick,
    );
    const pedal = s.throttle_pos_unfiltered
      ? 'throttle_pos_unfiltered'
      : 'throttle_pct';
    const pedalSamples = sampleTicks(
      rec.hz[pedal],
      rec.baseHz,
      minTick,
      nextTick,
    );
    const full = fullThrottleStart(s[pedal], pedalSamples, distAt);
    // Full already at the first sample of the search, which starts at the
    // slowest sample: on a corner taken flat that is the turn-in edge, so the
    // point is the boundary's, as with minSpeedAtEdge (pitlane #712).
    const fullAtEdge = Boolean(
      full && full.atM === distAt(pedalSamples.ticks[0]),
    );
    const f = {
      segTime: round(segTime, 3),
      localYellowSec: 0,
      offTrackSec: 0,
      minSpeedKmh: round(s.speed_kmh[minTick], 1),
      minSpeedAtM: round(distAt(minTick), 1),
      minSpeedAtEdge: minAtEdge,
      apexSpeedKmh: round(s.speed_kmh[apexTick], 1),
      brakeAtM: brake && round(brake.atM, 1),
      brakeAtResM: brake?.resM == null ? null : round(brake.resM, 1),
      fullThrottleAtM: full && round(full.atM, 1),
      fullThrottleAtResM: full?.resM == null ? null : round(full.resM, 1),
      fullThrottleAtEdge: fullAtEdge,
    };
    return f;
  });
  // Off-track and local-yellow time by corner, from the full-rate ticks.
  // Before corner 1's entry is this lap's part of the last segment.
  const {local} = flags;
  const add = (from, i0, i1, cornerOf) => {
    let li = 0;
    for (let i = i0; i < i1; i++) {
      const k = cornerOf(from.dist[i - from.i0]);
      if (k == null) continue;
      const dt = s.t[i + 1] - s.t[i];
      if (from.off[i - from.i0]) facts[k].offTrackSec += dt;
      while (li < local.length && local[li][1] < s.t[i]) li++;
      if (li < local.length && local[li][0] <= s.t[i]) {
        facts[k].localYellowSec += dt;
      }
    }
  };
  add(lap, lap.i0, lap.i1, m => {
    if (m < firstEntryM) return corners.length - 1;
    let k = 0;
    for (let c = 0; c < corners.length; c++) if (corners[c].entryM <= m) k = c;
    return k;
  });
  for (const f of facts) {
    f.offTrackSec = round(f.offTrackSec, 2);
    f.localYellowSec = round(f.localYellowSec, 2);
  }
  return facts;
}

// The lap's chart trace, one row per tick. A channel logged slower than the
// file (pedals at 50 Hz, position at 10 Hz) is written only on the ticks
// where it recorded a sample and left empty in between, so the app never
// reads a blended value as if it had been recorded.
export function traceCsv(rec, lap) {
  const {s, events} = rec;
  const recorded = name => {
    if (!s[name]) return null;
    const real = new Uint8Array(lap.i1 - lap.i0 + 1);
    const {ticks} = sampleTicks(rec.hz[name], rec.baseHz, lap.i0, lap.i1);
    for (const i of ticks) real[i - lap.i0] = 1;
    return real;
  };
  const real = {
    lat_deg: recorded('lat_deg'),
    lon_deg: recorded('lon_deg'),
    brake_pct: recorded('brake_pct'),
    throttle_pct: recorded('throttle_pct'),
    path_lateral_m: recorded('path_lateral_m'),
    track_edge_m: recorded('track_edge_m'),
  };
  const gears = events.gear || [];
  let gi = -1;
  const total = lap.dist[lap.dist.length - 1] || 1;
  const lines = [
    'Speed,LapDistPct,Lat,Lon,Brake,Throttle,RPM,SteeringWheelAngle,Gear,OffAsphalt,PathLateral,TrackEdge',
  ];
  for (let i = lap.i0; i <= lap.i1; i++) {
    while (gi + 1 < gears.length && gears[gi + 1].t <= s.t[i]) gi++;
    const k = i - lap.i0;
    const num = (arr, scale, digits) =>
      arr ? (arr[i] * scale).toFixed(digits) : '0';
    const sample = (name, scale, digits) =>
      real[name] && !real[name][k] ? '' : num(s[name], scale, digits);
    // Lateral position and the edge on the car's side, in metres from the
    // game's centre path (positive right, measured on Road Atlanta; the edge
    // has the lateral's sign). Empty where nothing was recorded, and on a
    // recording without the channel: never a zero that reads as "on the path".
    const metres = name =>
      !s[name] || (real[name] && !real[name][k]) || !Number.isFinite(s[name][i])
        ? ''
        : s[name][i].toFixed(2);
    lines.push(
      [
        num(s.speed_kmh, 1 / 3.6, 4),
        Math.max(0, Math.min(1, lap.dist[k] / total)).toFixed(6),
        sample('lat_deg', 1, 6),
        sample('lon_deg', 1, 6),
        sample('brake_pct', 0.01, 4),
        sample('throttle_pct', 0.01, 4),
        num(s.rpm, 1, 1),
        num(s.steer_pct, 0.01, 4),
        gi >= 0 ? gears[gi].v : 0,
        lap.off[k],
        metres('path_lateral_m'),
        metres('track_edge_m'),
      ].join(','),
    );
  }
  return lines.join('\n');
}

function startsInPits(rec) {
  const first = rec.events.in_pits?.[0];
  return Boolean(first && first.v === 1 && first.t - rec.s.t[0] < 1);
}

// recs: loaded recordings of one session, in time order.
// trackMap: the track's stored corners ({lengthM, corners}), or null to find
// them on this session. The map used is returned, so the caller can keep it.
export function analyzeSession(recs, {trackMap = null} = {}) {
  const laps = [];
  // A stint starts with a new recording or with the lap that leaves the pits,
  // but never while the current stint has no timed lap yet. That keeps the
  // grid or formation run from becoming a stint of its own.
  // Why each stint started: 'session', 'pit', 'reset' or 'gap' (fileChange.mjs,
  // for a new file), or 'pit' for leaving the pits. The lap a reset cut short
  // is tagged endedInReset and the next file's first lap afterReset, even
  // when no new stint opens.
  let stint = 0;
  let stintTimed = false;
  const stintStartReason = new Map();
  const openStint = reason => {
    if (stint === 0 || stintTimed) {
      stint++;
      stintTimed = false;
      stintStartReason.set(stint, reason);
    }
  };
  const flags = recs.map(rec => flagIntervals(rec.events));
  recs.forEach((rec, r) => {
    const pits = pitIntervals(rec.events.in_pits);
    const before = laps[laps.length - 1];
    const prev = recs[r - 1];
    const change = fileChange({
      lastLap: before ?? null,
      gapS: prev ? rec.s.t[0] - prev.s.t[prev.s.t.length - 1] : null,
      startsInPits: startsInPits(rec),
    });
    const reset = change === 'reset';
    if (reset) before.endedInReset = true;
    openStint(change);
    let first = true;
    for (const seg of segments(rec)) {
      const lap = analyzeLap(rec, seg, pits, flags[r]);
      lap.endedInReset = false;
      lap.afterReset = first && reset;
      if (!first && lap.pitOut) openStint('pit');
      first = false;
      if (lap.timed && !lap.partial) stintTimed = true;
      lap.stint = stint;
      lap.rec = r;
      lap.index = laps.filter(l => l.rec === r).length;
      laps.push(lap);
    }
  });

  // Why a lap should not be compared with the others. Off-track is not here:
  // it is a tag, because going wide is exactly what consistency should show.
  for (const lap of laps) {
    const reasons = [];
    if (lap.partial) reasons.push('partial');
    if (!lap.timed) reasons.push('untimed');
    if (lap.pitIn) reasons.push('pit-in');
    if (lap.pitOut) reasons.push('pit-out');
    lap.reasons = reasons;
  }
  // Slow: well outside this session's own spread (median + k robust sigmas),
  // so a consistent session gets a tight cut and a messy one a looser cut.
  const candidates = laps
    .filter(l => l.reasons.length === 0)
    .map(l => l.lapTime);
  const baseline = median(candidates);
  const spread = baseline
    ? 1.4826 * median(candidates.map(t => Math.abs(t - baseline)))
    : 0;
  const slowCut = baseline
    ? Math.min(
        baseline * SLOW_MAX_FACTOR,
        baseline + Math.max(SLOW_SIGMAS * spread, SLOW_MIN_SEC),
      )
    : Infinity;
  for (const lap of laps) {
    if (lap.reasons.length === 0 && lap.lapTime > slowCut) {
      lap.reasons.push('slow');
    }
    lap.comparable = lap.reasons.length === 0;
    lap.clean = lap.comparable && !lap.offtrack;
  }

  const comparable = laps.filter(l => l.comparable);
  const pool = comparable.length
    ? comparable
    : laps.filter(l => l.timed && !l.partial);
  const best = pool.reduce(
    (a, b) => (b.lapTime < (a?.lapTime ?? Infinity) ? b : a),
    null,
  );

  let band = null;
  let gridN = 0;
  if (best && best.distanceM > 100) {
    gridN = Math.floor(best.distanceM / GRID_M) + 1;
    for (const lap of laps) {
      if (!lap.partial && lap.distanceM > best.distanceM * 0.9) {
        lap.grid = onGrid(recs[lap.rec], lap, gridN);
      }
    }
    const bandLaps = (comparable.length >= 3 ? comparable : pool).filter(
      l => l.grid,
    );
    band = {
      stepM: GRID_M,
      lengthM: round(best.distanceM, 1),
      laps: bandLaps.length,
      speed: stats(bandLaps, 'speed', gridN, 1),
      throttle: stats(bandLaps, 'throttle', gridN, 1),
      brake: stats(bandLaps, 'brake', gridN, 1),
    };
  }

  // The track's corners: the stored map when it fits this lap length, else
  // found from this session's median lap.
  // A stored map is never replaced here: a session it does not fit gets a
  // map of its own for this analysis only, and says so. Only a session with
  // enough clean laps may create the stored map.
  // A stored map of an older shape counts as no map at all.
  if (trackMap && trackMap.mapVersion !== trackMapVersion) trackMap = null;
  const fits =
    trackMap &&
    best &&
    Math.abs(trackMap.lengthM - best.distanceM) <= best.distanceM * 0.03;
  const built = fits ? null : buildTrackMap(recs, comparable, best, gridN);
  const map = fits ? trackMap : built?.map ?? null;
  const trackMapSource = fits
    ? 'stored'
    : !built
    ? null
    : !trackMap && built.laps >= MAP_MIN_LAPS
    ? 'new'
    : 'session';
  const newTrackMap = trackMapSource === 'new';
  if (map?.corners.length) {
    laps.forEach(lap => {
      if (!cornersFit(lap, map)) return;
      const facts = list =>
        cornerFacts(recs[lap.rec], lap, list, flags[lap.rec]);
      lap.corners = facts(map.corners);
      // The same facts for each single corner inside a section, for drilling
      // in. A section's entry is its first part's entry, so a section's
      // segment time is the sum of its parts'.
      if (map.corners.some(c => c.parts)) {
        const byPart = facts(map.corners.flatMap(c => c.parts ?? []));
        let k = 0;
        lap.corners.forEach((f, i) => {
          const n = map.corners[i].parts?.length ?? 0;
          f.parts = byPart.slice(k, k + n);
          k += n;
        });
      }
    });
  }

  // Consistency: the laps run in normal racing conditions, through the
  // shared module the app also runs on a driver's own selection.
  let lastWear = null;
  const stintStart = new Map();
  const facts = laps.map((lap, i) => {
    if (!stintStart.has(lap.stint)) stintStart.set(lap.stint, i);
    // Fresh tyres: average wear jumps up from the lap before.
    lap.newTyres =
      lap.wearStart != null && lastWear != null && lap.wearStart > lastWear + 1;
    if (lap.wearStart != null) lastWear = lap.wearStart;
    lap.stintLap = i - stintStart.get(lap.stint);
    lap.start = i === 0 && !lap.pitOut;
    return lapFacts(String(i), lap);
  });
  const {reasons: excluded, damage} = selectNormalRacing(facts);
  // Every stint of the session, so one with no normal-racing laps still
  // shows up (laps: 0 and why). Lap ids here are indexes into laps; the
  // uploader swaps in the stored lap ids.
  const sessionStints = [];
  laps.forEach((lap, i) => {
    let st = sessionStints[sessionStints.length - 1];
    if (!st || st.n !== lap.stint) {
      st = {
        n: lap.stint,
        startReason: stintStartReason.get(lap.stint),
        laps: [],
      };
      sessionStints.push(st);
    }
    st.laps.push({id: String(i), lapNumber: lap.lapNumber});
  });
  const consistency = analyzeConsistency(
    facts.filter(f => excluded.get(f.id).length === 0),
    undefined,
    sessionStints,
  );
  const byId = new Map(consistency.laps.map(r => [r.id, r]));
  facts.forEach((f, i) => {
    laps[i].excluded = excluded.get(f.id);
    const r = byId.get(f.id);
    laps[i].consistency = r
      ? {residual: r.residual, offPace: r.offPace, losses: r.losses}
      : null;
  });

  const stints = [];
  for (const lap of laps) {
    let st = stints[stints.length - 1];
    if (!st || st.n !== lap.stint) {
      st = {n: lap.stint, laps: []};
      stints.push(st);
    }
    st.laps.push(lap);
  }

  // Per stint: the median use per green lap, then every lap's and stop's
  // laps left at that median.
  const stintMedians = new Map(stints.map(st => [st.n, stintFuel(st.laps)]));
  fillLapsLeft(laps, stintMedians);
  markGreen(laps);
  const firstFuel = laps.find(l => l.fuel?.startL != null);
  const ratio = litresPerVePct(laps);

  return {
    laps,
    best,
    fuel: {
      startL: firstFuel?.fuel.startL ?? null,
      fillLimitL: recs[0].recording.fuelSetup?.fillLimitL ?? null,
      tankL: recs[0].recording.fuelSetup?.tankL ?? null,
      // Litres per 1 % of Virtual Energy, measured (fuelFacts.mjs).
      litresPerVePct: ratio.drive,
      litresPerVePctStop: ratio.stop,
    },
    trackMap: map,
    newTrackMap,
    trackMapSource,
    trackMapMismatch: Boolean(trackMap && !fits),
    consistency: {
      summary: consistency.summary,
      stints: consistency.stints,
      corners: consistency.corners,
      overview: consistency.overview,
      thresholds: consistency.thresholds,
      // Possible damage: every stretch after an incident that was checked,
      // with the evidence, by lap number.
      damage: damage.map(({incidentLapId, lapIds, ...check}) => check),
    },
    band,
    summary: {
      lapCount: laps.length,
      comparableCount: comparable.length,
      bestLapTime: best?.lapTime ?? null,
      medianLapTime: round(median(comparable.map(l => l.lapTime)), 3),
      stdevLapTime: round(stdev(comparable.map(l => l.lapTime)), 3),
      stints: stints.map(st => {
        const c = st.laps.filter(l => l.comparable).map(l => l.lapTime);
        return {
          n: st.n,
          startReason: stintStartReason.get(st.n),
          firstLap: st.laps[0].lapNumber,
          lastLap: st.laps[st.laps.length - 1].lapNumber,
          laps: st.laps.length,
          comparable: c.length,
          bestLapTime: c.length ? round(Math.min(...c), 3) : null,
          medianLapTime: round(median(c), 3),
          stdevLapTime: round(stdev(c), 3),
          ...stintMedians.get(st.n),
        };
      }),
    },
    trace: lap => traceCsv(recs[lap.rec], lap),
  };
}

function buildTrackMap(recs, comparable, best, gridN) {
  if (!best || !gridN) return null;
  if (!recs.every(r => r.s.lat_deg && r.s.lon_deg)) return null;
  const laps = comparable.filter(
    l =>
      l.grid && Math.abs(l.distanceM - best.distanceM) < best.distanceM * 0.01,
  );
  if (laps.length < 3) return null;
  return {
    laps: laps.length,
    map: {
      mapVersion: trackMapVersion,
      lengthM: round(best.distanceM, 1),
      stepM: GRID_M,
      // Sections, each holding its single corners as parts.
      corners: findTrackSections(profile(laps, gridN)),
    },
  };
}

// What src/analysis/consistency.ts needs to know about a lap. The lap doc
// stores the same fields, so the app can rebuild these for any selection.
export function lapFacts(id, lap) {
  return {
    id,
    lapNumber: lap.lapNumber,
    stint: lap.stint,
    stintLap: lap.stintLap,
    lapTime: lap.lapTime,
    timed: lap.timed,
    partial: lap.partial,
    pitIn: lap.pitIn,
    pitOut: lap.pitOut,
    start: lap.start,
    newTyres: lap.newTyres,
    offtrack: lap.offtrack,
    offTrackSec: lap.offTrackSec,
    impactMax: lap.impactMax,
    tyreCarcassC: lap.tyreCarcassC,
    courseYellowSec: lap.courseYellowSec,
    compound: lap.compound,
    wetness: lap.wetness,
    corners: lap.corners ?? null,
  };
}

function stats(laps, key, gridN, digits) {
  const p10 = new Array(gridN);
  const p50 = new Array(gridN);
  const p90 = new Array(gridN);
  for (let g = 0; g < gridN; g++) {
    const values = laps.map(l => l.grid[key][g]);
    p10[g] = round(quantile(values, 0.1), digits);
    p50[g] = round(quantile(values, 0.5), digits);
    p90[g] = round(quantile(values, 0.9), digits);
  }
  return {p10, p50, p90};
}
