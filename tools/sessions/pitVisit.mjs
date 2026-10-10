// Why the car was in the pit lane (pit-wall thread 44 #1912, #1921-#1923).
//
// A pit visit is a window of the In Pits channel. Most are a service (fuel,
// VE, tyres), but some are not: a repair after damage, or a penalty served
// (a drive-through, or a stop-go). A visit that is not a service must not teach
// the pit loss or the refuel rate, and must not be read as a strategy. The
// reason is a fact from the data (no coaching): what the car did in the window.
//
// Evidence, all already recorded:
//   speed        the game's ground speed (`speed_kmh`): the time stood still
//   added        fuel and VE added in the window (fuelFacts.mjs)
//   tyres        a wear jump in the window (fuelFacts.mjs tyreChange)
//   damage       the live capture's `mDentSeverity_0..7` and `mDetached`
//                (playerDamage.mjs): lower at the exit than at the entry means
//                the stop repaired something. Absent where the capture is not on
//                the PC (it is pruned after a week): the visit then says so.
//
// Tonight's Road Atlanta race (2026-10-02) read by hand: visit 1, 95.6 s in the
// lane, 61 s stationary, nothing added, dent sum 2 -> 0 and one detached part
// -> 0: a repair. Visit 2, 45.4 s in the lane, 10.4 s stationary, nothing
// added, no damage change: a penalty, a stop-go.
import {REFUEL_FUEL_MIN_L, REFUEL_VE_MIN_PCT} from '../../src/analysis/refuel.ts';

/** Bump when the rules below change: it goes into analyze.mjs's blockVersions, so sessions are re-analysed. */
export const PIT_VISIT_VERSION = 2;

/** Slower than this is standing still (km/h). The game's speed reads 0.0 to 2.7 around a stop. */
export const STATIONARY_KMH = 1;
/** Standing still this long (s, in all) is a stop; less is the car slowing for a speed bump or a box. */
export const STOPPED_MIN_S = 3;
/** Fuel (L) and VE (%) added by a service: under these is sensor noise. The fill ramp is ~3.4 L/s. */
export const ADDED_FUEL_MIN_L = REFUEL_FUEL_MIN_L;
export const ADDED_VE_MIN_PCT = REFUEL_VE_MIN_PCT;

/**
 * Seconds the car stood still inside [a, b]: the time between samples whose
 * speed is under STATIONARY_KMH. `t` (s) and `speedKmh` are parallel arrays.
 */
export function stationaryS(t, speedKmh, a, b) {
  let total = 0;
  for (let i = 1; i < t.length; i++) {
    if (t[i] <= a) continue;
    if (t[i - 1] >= b) break;
    const lo = Math.max(t[i - 1], a);
    const hi = Math.min(t[i], b);
    if (hi > lo && speedKmh[i] < STATIONARY_KMH) total += hi - lo;
  }
  return total;
}

/**
 * The damage the car carried at time `at`: the last sample at or before it.
 * `damage` is {et, dent, detached} (parallel arrays sorted by et). Null when
 * there is no sample that early.
 */
export function damageAt(damage, at) {
  if (!damage || damage.et.length === 0 || damage.et[0] > at) return null;
  let lo = 0;
  let hi = damage.et.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (damage.et[mid] <= at) lo = mid;
    else hi = mid - 1;
  }
  return {dent: damage.dent[lo], detached: damage.detached[lo]};
}

/**
 * Whether the stop repaired something: fewer dented panels or detached parts at
 * the exit than at the entry. Null without damage samples on both sides.
 */
export function repaired(damage, a, b) {
  const before = damageAt(damage, a);
  const after = damageAt(damage, b);
  if (!before || !after) return null;
  return after.dent < before.dent || after.detached < before.detached;
}

/**
 * The reason for one visit.
 *
 *   {v, kind, detail, did, stationaryS, evidence}
 *
 * kind: 'service' | 'repair' | 'penalty' | 'through' | 'unknown', the primary
 * reason. A penalty exists only in a race (parc #1957: in practice a run
 * through the lane without stopping is just that, kind 'through'). A
 * repair outranks a service when both happened (the stationary time is the
 * repair's). `did` lists everything that happened in the visit ('refuel',
 * 'tyres', 'repair'), so a repair that also refuelled is
 * {kind: 'repair', did: ['refuel', 'repair']} (parc #1917). `detail` is
 * 'drive-through' or 'stop-go' for a penalty, else null. The pit-loss and
 * refuel-rate learners take kind 'service' only: its stationary time is the
 * service's alone.
 *
 * Input: {inPitS (null when the session ended in the lane), stationaryS (null
 * without a speed channel), added {fuelL, vePct}, tyresChanged, repaired (null
 * without damage samples), race (the session is a race)}.
 */
export function classifyVisit({
  inPitS,
  stationaryS: still,
  added,
  tyresChanged,
  repaired: fixed,
  race = false,
}) {
  const refuel =
    (added?.fuelL ?? 0) >= ADDED_FUEL_MIN_L ||
    (added?.vePct ?? 0) >= ADDED_VE_MIN_PCT;
  const tyres = tyresChanged === true;
  const did = [];
  if (refuel) did.push('refuel');
  if (tyres) did.push('tyres');
  if (fixed === true) did.push('repair');
  const evidence = [];
  if (still != null)
    evidence.push(`stationary ${Math.round(still * 10) / 10} s`);
  if (refuel) evidence.push('fuel or VE added');
  if (tyres) evidence.push('tyres changed');
  if (fixed === true) evidence.push('damage repaired');
  const result = (kind, detail = null, extra = []) => ({
    v: PIT_VISIT_VERSION,
    kind,
    detail,
    did,
    stationaryS: still == null ? null : Math.round(still * 10) / 10,
    evidence: [...evidence, ...extra],
  });
  // A window that never ends, or no speed to read: nothing can be said.
  if (inPitS == null)
    return result('unknown', null, ['session ended in the pit lane']);
  if (still == null) return result('unknown', null, ['no speed channel']);
  const stopped = still >= STOPPED_MIN_S;
  if (!stopped) {
    // Through the lane without stopping, nothing done: a drive-through when it
    // is a race, else just a run through the lane.
    if (refuel || tyres)
      return result('unknown', null, [
        'added or changed without standing still',
      ]);
    return race ? result('penalty', 'drive-through') : result('through');
  }
  if (fixed === true) return result('repair');
  if (refuel || tyres) return result('service');
  // Stopped with nothing done: a stop-go served in a race, unless it was a
  // repair we cannot see (no damage samples to say). Outside a race nothing
  // says why the car stood still.
  if (!race)
    return result('unknown', null, [
      'stopped with nothing done outside a race',
    ]);
  if (fixed === false) return result('penalty', 'stop-go');
  return result('unknown', null, ['no damage record']);
}
