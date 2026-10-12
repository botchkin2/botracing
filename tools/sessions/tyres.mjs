// Per-lap tyre facts (pit-wall thread 38, the tires audit; thread 44, E5): for
// each wheel, wear at the end of the lap, the lap's median pressure and
// temperatures, and which wheels got a new tyre in the pit stop that ended
// during it. Plain numbers off the recording's own channels, on the shared
// GPS-time clock the archive is written on (lmu.mjs writeArchive), so the
// channels line up with each other and with the pit windows.
import {SESSION_START_S, tyreChange} from './fuelFacts.mjs';

/**
 * Bump when the rules below change: it goes into analyze.mjs's blockVersions,
 * which the sync's session fingerprint hashes, and onto each lap's `tyres.v`.
 * 1: per-wheel wear at the lap end, median pressure and temperatures outside
 * the pit lane (dead zeros out), and the wheels changed in the stop that ended
 * during the lap.
 * 2: the change threshold drops from 5 % to 0.5 % (fuelFacts TYRE_JUMP_PCT), so
 * a tyre swapped after a short run counts; and `hotPressureKpa`, the stabilised
 * hot pressure, is added.
 * 3: `treadC`, the median temperature of the tread's inner, centre and outer
 * thirds per wheel; and the pit stop's `tyres` gains `coolDown` and `compound`
 * (fuelFacts.mjs). Thread 44 #1607.
 */
export const TYRES_VERSION = 3;

// Wheel names as the doc writes them, with the archive's channel suffix.
const WHEELS = [
  ['FL', 'fl'],
  ['FR', 'fr'],
  ['RL', 'rl'],
  ['RR', 'rr'],
];

// The doc field and the archive's channel prefix of what is read as a median
// over the lap. Wear is read at the end of the lap instead: it only falls, and
// the end is what the next stint starts from.
const MEDIAN_FIELDS = [
  ['pressureKpa', 'tyres_pressure'],
  ['rubberC', 'tyres_rubber_temp'],
  ['carcassC', 'tyres_carcass_temp'],
];

// The tread's three temperatures are car-fixed, not per wheel (tires audit,
// pit-wall thread 38 #1111): the "Left" channel is the car's left edge and
// "Right" its right edge on all four wheels, so the inner third is Right on
// the left wheels and Left on the right wheels (negative camber makes the
// outer edge the cooler one).
const TREAD_CHANNELS = {
  left: 'tyres_temp_left',
  right: 'tyres_temp_right',
  centre: 'tyres_temp_centre',
};
const INNER_SIDE = {FL: 'right', RL: 'right', FR: 'left', RR: 'left'};
const OUTER_SIDE = {FL: 'left', RL: 'left', FR: 'right', RR: 'right'};

const round1 = v => Math.round(v * 10) / 10;

/**
 * Laps into a stint before the tyres' hot pressure has settled: the end-of-lap
 * pressure counts from the third lap of a stint (stintLap 2, counted from 0).
 * The out-lap and the first lap on new tyres understate it (setup, thread 44
 * #1539). Applied after the stints are known (`settleHotPressure`).
 */
export const HOT_PRESSURE_FROM_STINT_LAP = 2;
/** The reading is the median of the lap's last few seconds, so one glitchy sample cannot be it. */
export const HOT_PRESSURE_WINDOW_S = 5;

// A dead sensor reads exactly 0 (a flat tyre's wear, pressure and temperature
// alike), which is not a measurement. Never put it in a doc or an average.
const live = v => Number.isFinite(v) && v > 0;

function median(values) {
  if (values.length === 0) return null;
  const v = Float64Array.from(values).sort();
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** {FL, FR, RL, RR} from a reader of one wheel's channel; null when none exists. */
function perWheel(s, prefix, read) {
  const columns = WHEELS.map(([, w]) => s[`${prefix}_${w}`]);
  if (columns.every(c => !c)) return null;
  const out = {};
  WHEELS.forEach(([name], k) => {
    const v = columns[k] ? read(columns[k]) : null;
    out[name] = v == null ? null : round1(v);
  });
  return out;
}

/**
 * The tyre facts of one lap. `i0`..`i1` are the lap's ticks, `seg` its time
 * window, `pits` the pit windows [in, out] of the recording, `version` the
 * block's stamp (blockVersions.tyres).
 *
 * Every per-wheel field is {FL, FR, RL, RR}, a wheel with no channel or a
 * dead sensor null, and the whole field null when the recording has no such
 * channel.
 * - wearPct: at the end of the lap.
 * - pressureKpa, rubberC, carcassC: the median over the lap's ticks that are
 *   outside the pit lane (a stop cools the tyres), dead zeros left out. One
 *   reading at the line would be taken on the main straight, where they cool.
 * - hotPressureKpa: the median pressure of the lap's last HOT_PRESSURE_WINDOW_S
 *   seconds, outside the pit lane, dead zeros left out: what an engineer reads as the stabilised hot pressure
 *   once the stint's laps are known (`settleHotPressure` nulls it on a stint's
 *   first laps). The median above is close on a flying lap but understates the
 *   out-lap.
 * - changed: the wheels with a new tyre in a pit window that ended during this
 *   lap, from the same per-stop test as the pit stop's `tyres` (fuelFacts
 *   tyreChange). A window in the first SESSION_START_S of the recording is the
 *   garage exit, not a stop. Null without a wear channel.
 *
 * Null for the whole lap when the recording has none of these channels.
 */
export function lapTyres(s, i0, i1, seg, pits, version) {
  const wearPct = perWheel(s, 'tyres_wear', c => (live(c[i1]) ? c[i1] : null));
  const out = {v: version, wearPct};
  const inLane = i => pits.some(([a, b]) => s.t[i] >= a && s.t[i] <= b);
  out.hotPressureKpa = perWheel(s, 'tyres_pressure', c => {
    const kept = [];
    for (
      let i = i1;
      i >= i0 && s.t[i] >= s.t[i1] - HOT_PRESSURE_WINDOW_S;
      i--
    ) {
      if (live(c[i]) && !inLane(i)) kept.push(c[i]);
    }
    return median(kept);
  });
  for (const [field, prefix] of MEDIAN_FIELDS) {
    out[field] = perWheel(s, prefix, c => {
      const kept = [];
      for (let i = i0; i <= i1; i++) {
        if (live(c[i]) && !inLane(i)) kept.push(c[i]);
      }
      return median(kept);
    });
  }
  out.treadC = treadTemps(s, i0, i1, inLane);
  const t0 = s.t[0];
  // A window belongs to the lap its pit exit falls in; one that never ends
  // (the session finished in the pits) to the lap it was entered in.
  const ending = pits.filter(([a, b]) =>
    a - t0 < SESSION_START_S
      ? false
      : b === Infinity
      ? a > seg.start && a <= seg.end
      : b > seg.start && b <= seg.end,
  );
  const hasWear = WHEELS.some(([, w]) => s[`tyres_wear_${w}`]);
  const changed = new Set();
  for (const [a, b] of ending) {
    for (const w of tyreChange(s, a, b)?.wheels ?? []) changed.add(w);
  }
  out.changed = hasWear
    ? WHEELS.map(([n]) => n).filter(n => changed.has(n))
    : null;
  const anyChannel =
    wearPct != null ||
    out.treadC != null ||
    MEDIAN_FIELDS.some(([field]) => out[field] != null);
  return anyChannel ? out : null;
}

/**
 * {FL, FR, RL, RR}, each {inner, centre, outer}: the median temperature of the
 * tread's three thirds over the lap's ticks outside the pit lane, dead zeros
 * left out. A third with no channel or only dead readings is null, a wheel
 * with none of the three is null, and the whole field is null when the
 * recording has no tread channel at all.
 */
function treadTemps(s, i0, i1, inLane) {
  const read = (key, w) => {
    const c = s[`${key}_${w}`];
    if (!c) return null;
    const kept = [];
    for (let i = i0; i <= i1; i++) {
      if (live(c[i]) && !inLane(i)) kept.push(c[i]);
    }
    const m = median(kept);
    return m == null ? null : round1(m);
  };
  const any = WHEELS.some(([, w]) =>
    Object.values(TREAD_CHANNELS).some(key => s[`${key}_${w}`]),
  );
  if (!any) return null;
  const out = {};
  for (const [name, w] of WHEELS) {
    const v = {
      inner: read(TREAD_CHANNELS[INNER_SIDE[name]], w),
      centre: read(TREAD_CHANNELS.centre, w),
      outer: read(TREAD_CHANNELS[OUTER_SIDE[name]], w),
    };
    out[name] =
      v.inner == null && v.centre == null && v.outer == null ? null : v;
  }
  return out;
}

/**
 * The stabilised hot pressure is only read from the third lap of a stint:
 * null it on the laps before. `laps` carry `tyres` and `stintLap`.
 */
export function settleHotPressure(laps) {
  for (const lap of laps) {
    if (lap.tyres && lap.stintLap < HOT_PRESSURE_FROM_STINT_LAP)
      lap.tyres.hotPressureKpa = null;
  }
}
