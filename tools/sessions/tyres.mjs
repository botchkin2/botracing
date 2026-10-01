// Per-lap tyre facts (pit-wall thread 38, the tires audit; thread 44, E5): for
// each wheel, wear at the end of the lap, the lap's median pressure and
// temperatures, and which wheels got a new tyre in the pit stop that ended
// during it. Plain numbers off the recording's own channels, on the shared
// GPS-time clock the archive is written on (lmu.mjs writeArchive), so the
// channels line up with each other and with the pit windows.
import {SESSION_START_S, tyreChange} from './fuelFacts.mjs';

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

const round1 = v => Math.round(v * 10) / 10;

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
  for (const [field, prefix] of MEDIAN_FIELDS) {
    out[field] = perWheel(s, prefix, c => {
      const kept = [];
      for (let i = i0; i <= i1; i++) {
        if (live(c[i]) && !inLane(i)) kept.push(c[i]);
      }
      return median(kept);
    });
  }
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
    wearPct != null || MEDIAN_FIELDS.some(([field]) => out[field] != null);
  return anyChannel ? out : null;
}
