// Lap times of every class in a race, from the encoded field (field.mjs):
// the faster classes' pace for the Plan's class timing (pit-wall thread 44,
// round 6 section 2). The session doc carries `classLaps`, so the app never
// downloads a field to draw the Plan.
//
// The field has no lap times. A car's lap is the time between two crossings
// of the line, found where its lap distance wraps from the end of the lap to
// the start, interpolated between the two updates either side (a 5 Hz update
// can sit up to 0.2 s after the line, which would smear p10 and p90).
import {classKey} from '../../src/analysis/carClass.ts';
import {decodeField} from './fieldTags.mjs';

// A lap counts when the car was in the field, out of the pits and under no
// flag for all of it. The car's first crossing only starts the clock, and the
// first lap after it is the start: on the Daytona races of 2026-09-29/30
// every car's first measured lap is 95-99 s against a 110 s GT3 pace, so it
// is never counted.
//
// A lap slower than this times the class median is a spin, a slow car or an
// unflagged crash, not pace.
export const SLOW_CUT = 1.15;
// Fewer than this many laps is not a class pace.
export const MIN_CLASS_LAPS = 3;
// The wrap: from the last 30% of the lap to the first 30%.
const WRAP_FROM = 0.7;
const WRAP_TO = 0.3;

// When the car crossed the line, between updates u-1 and u (lap distance
// `prev` before the line, `lapDistM[u]` after). The track length is only the
// longest distance seen, which is short of the real one by up to a step, so
// the time comes from the speed just after the line: the car was `d / v`
// seconds past it at update u. The length is the fallback when there is no
// clean update after.
function crossingT(lapDistM, etS, u, prev, L) {
  const d = lapDistM[u];
  const next = lapDistM[u + 1];
  if (next !== undefined && next !== null && next > d) {
    const v = (next - d) / (etS[u + 1] - etS[u]);
    return etS[u] - d / v;
  }
  const toLine = L - prev;
  return etS[u - 1] + ((etS[u] - etS[u - 1]) * toLine) / (toLine + d);
}

// Green lap times per car, seconds.
export function carLaps(field) {
  const {etS, cars} = decodeField(field);
  let L = 0;
  for (const c of cars)
    for (const d of c.lapDistM) if (d !== null && d > L) L = d;
  if (L === 0) return cars.map(() => []);
  return cars.map(c => {
    const laps = [];
    let startT = null;
    let first = true;
    let clean = false;
    let prev = null;
    for (let u = 0; u < etS.length; u++) {
      const d = c.lapDistM[u];
      if (d === null) {
        clean = false;
        prev = null;
        continue;
      }
      if (c.inPits[u] === 1 || c.flag[u] > 0) clean = false;
      if (prev !== null && prev > WRAP_FROM * L && d < WRAP_TO * L) {
        const at = crossingT(c.lapDistM, etS, u, prev, L);
        if (startT !== null) {
          if (clean && !first) laps.push(at - startT);
          first = false;
        }
        startT = at;
        clean = true;
      }
      prev = d;
    }
    return laps;
  });
}

const round = v => Math.round(v * 100) / 100;

// Nearest rank on a sorted array.
function rank(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

// {hypercar: {cars, laps, medianS, p10S, p90S}, ...}, or null when no class
// has MIN_CLASS_LAPS laps. `cars` counts cars with at least one kept lap.
export function classLaps(field) {
  const byClass = new Map();
  const per = carLaps(field);
  field.cars.forEach((c, i) => {
    const key = classKey(c.class);
    const list = byClass.get(key) ?? [];
    for (const t of per[i]) list.push({car: i, t});
    byClass.set(key, list);
  });
  const out = {};
  for (const [key, list] of byClass) {
    const all = list.map(l => l.t).sort((a, b) => a - b);
    if (all.length === 0) continue;
    const cut = SLOW_CUT * rank(all, 0.5);
    const kept = list.filter(l => l.t <= cut);
    if (kept.length < MIN_CLASS_LAPS) continue;
    const times = kept.map(l => l.t).sort((a, b) => a - b);
    out[key] = {
      cars: new Set(kept.map(l => l.car)).size,
      laps: times.length,
      medianS: round(rank(times, 0.5)),
      p10S: round(rank(times, 0.1)),
      p90S: round(rank(times, 0.9)),
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}
