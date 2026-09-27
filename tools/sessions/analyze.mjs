// Session analysis, computed once at upload so the app never crunches a race.
//
// Input is our own archive (samples.parquet + events.parquet per recording),
// so this file knows nothing about any one sim.
//
// Output per session:
//   laps        every start/finish segment, with stint, pit in/out, off-track
//               time, impacts, sectors, and the reasons it is not comparable.
//   corners     found on the reference lap (best comparable lap) as speed minima.
//   per lap     per-corner segment time, min speed, brake point, full throttle.
//   band        median and p10/p90 of speed, throttle, brake on a 5 m grid,
//               over the comparable laps. This is the consistency view.
//   traces      one CSV per lap in the format the app already draws.
import {columns, sqlPath} from './duck.mjs';

export const analysisVersion = 1;

const GRID_M = 5;
const SLOW_SIGMAS = 3;
const SLOW_MIN_SEC = 1.5;
const SLOW_MAX_FACTOR = 1.07;
const CORNER_DROP_KMH = 12;
const OFF_TRACK_SEC = 0.2;

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
  return {recording, s, events, ticks: s.t.length};
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

function analyzeLap(rec, seg, pits) {
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
    sectors: sectorTimes(
      events,
      seg.start,
      seg.end,
      timed ? gameLapTime : null,
    ),
    distanceM: round(dist[dist.length - 1], 1),
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
  }
  return out;
}

function smooth(values, radius) {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let n = 0;
    for (let k = -radius; k <= radius; k++) {
      const v = values[i + k];
      if (Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
    out[i] = n ? sum / n : NaN;
  }
  return out;
}

// Corners are speed minima on the reference lap that sit at least
// CORNER_DROP_KMH below the fastest point on each side before the next one.
export function findCorners(speed) {
  const v = smooth(speed, 3);
  const apexes = [];
  let i = 0;
  const n = v.length;
  let peak = v[0];
  let trough = v[0];
  let troughAt = 0;
  let falling = false;
  for (i = 1; i < n; i++) {
    if (!falling) {
      if (v[i] > peak) peak = v[i];
      if (peak - v[i] >= CORNER_DROP_KMH) {
        falling = true;
        trough = v[i];
        troughAt = i;
      }
    } else {
      if (v[i] < trough) {
        trough = v[i];
        troughAt = i;
      }
      if (v[i] - trough >= CORNER_DROP_KMH) {
        apexes.push(troughAt);
        falling = false;
        peak = v[i];
      }
    }
  }
  if (falling) apexes.push(troughAt);
  return apexes.map((apex, k) => {
    const prev = k > 0 ? apexes[k - 1] : null;
    const next = k + 1 < apexes.length ? apexes[k + 1] : null;
    const start = prev == null ? 0 : Math.round((prev + apex) / 2);
    const end = next == null ? n - 1 : Math.round((apex + next) / 2);
    return {
      n: k + 1,
      apexM: apex * GRID_M,
      startM: start * GRID_M,
      endM: end * GRID_M,
      _a: apex,
      _s: start,
      _e: end,
    };
  });
}

function cornerMetrics(grid, corner) {
  const {_s: s, _e: e} = corner;
  let minSpeed = Infinity;
  let minAt = s;
  for (let g = s; g <= e; g++) {
    if (grid.speed[g] < minSpeed) {
      minSpeed = grid.speed[g];
      minAt = g;
    }
  }
  // Brake point: where the last press before the apex began.
  let brakeAt = null;
  for (let g = minAt; g >= s; g--) {
    if (grid.brake[g] >= 10) brakeAt = g;
    else if (brakeAt != null) break;
  }
  // Full throttle: first point after the apex at 95% or more.
  let fullAt = null;
  for (let g = minAt; g <= e; g++) {
    if (grid.throttle[g] >= 95) {
      fullAt = g;
      break;
    }
  }
  return {
    n: corner.n,
    segTime: round(grid.time[e] - grid.time[s], 3),
    minSpeed: round(minSpeed, 1),
    minSpeedAtM: minAt * GRID_M,
    brakeAtM: brakeAt == null ? null : brakeAt * GRID_M,
    fullThrottleAtM: fullAt == null ? null : fullAt * GRID_M,
  };
}

// The trace CSV the app already reads, at the full sample rate.
function traceCsv(rec, lap) {
  const {s, events} = rec;
  const gears = events.gear || [];
  let gi = -1;
  const total = lap.dist[lap.dist.length - 1] || 1;
  const lines = [
    'Speed,LapDistPct,Lat,Lon,Brake,Throttle,RPM,SteeringWheelAngle,Gear,OffAsphalt',
  ];
  for (let i = lap.i0; i <= lap.i1; i++) {
    while (gi + 1 < gears.length && gears[gi + 1].t <= s.t[i]) gi++;
    const k = i - lap.i0;
    const num = (arr, scale, digits) =>
      arr ? (arr[i] * scale).toFixed(digits) : '0';
    lines.push(
      [
        num(s.speed_kmh, 1 / 3.6, 4),
        Math.max(0, Math.min(1, lap.dist[k] / total)).toFixed(6),
        num(s.lat_deg, 1, 6),
        num(s.lon_deg, 1, 6),
        num(s.brake_pct, 0.01, 4),
        num(s.throttle_pct, 0.01, 4),
        num(s.rpm, 1, 1),
        num(s.steer_pct, 0.01, 4),
        gi >= 0 ? gears[gi].v : 0,
        lap.off[k],
      ].join(','),
    );
  }
  return lines.join('\n');
}

// recs: loaded recordings of one session, in time order.
export function analyzeSession(recs) {
  const laps = [];
  // A stint starts with a new recording or with the lap that leaves the pits,
  // but never while the current stint has no timed lap yet. That keeps the
  // grid or formation run from becoming a stint of its own.
  let stint = 0;
  let stintTimed = false;
  const openStint = () => {
    if (stint === 0 || stintTimed) {
      stint++;
      stintTimed = false;
    }
  };
  recs.forEach((rec, r) => {
    const pits = pitIntervals(rec.events.in_pits);
    openStint();
    let first = true;
    for (const seg of segments(rec)) {
      const lap = analyzeLap(rec, seg, pits);
      if (!first && lap.pitOut) openStint();
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

  let corners = [];
  let band = null;
  if (best && best.distanceM > 100) {
    const gridN = Math.floor(best.distanceM / GRID_M) + 1;
    for (const lap of laps) {
      if (!lap.partial && lap.distanceM > best.distanceM * 0.9) {
        lap.grid = onGrid(recs[lap.rec], lap, gridN);
      }
    }
    corners = findCorners(best.grid.speed);
    for (const lap of laps) {
      if (lap.grid) lap.corners = corners.map(c => cornerMetrics(lap.grid, c));
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

  const cornerStats = corners.map((c, k) => {
    const rows = comparable.filter(l => l.corners).map(l => l.corners[k]);
    const seg = rows.map(r => r.segTime);
    return {
      n: c.n,
      apexM: c.apexM,
      startM: c.startM,
      endM: c.endM,
      bestSegTime: round(Math.min(...seg), 3),
      medianSegTime: round(median(seg), 3),
      stdevSegTime: round(stdev(seg), 3),
      medianMinSpeed: round(median(rows.map(r => r.minSpeed)), 1),
      stdevBrakeAtM: round(stdev(rows.map(r => r.brakeAtM)), 1),
    };
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

  return {
    laps,
    best,
    corners,
    cornerStats,
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
          firstLap: st.laps[0].lapNumber,
          lastLap: st.laps[st.laps.length - 1].lapNumber,
          laps: st.laps.length,
          comparable: c.length,
          bestLapTime: c.length ? round(Math.min(...c), 3) : null,
          medianLapTime: round(median(c), 3),
          stdevLapTime: round(stdev(c), 3),
        };
      }),
    },
    trace: lap => traceCsv(recs[lap.rec], lap),
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
