// What a resync keeps of the stored docs when the capture is gone (pit-wall
// thread 1 #4549). The live capture is pruned after 14 days (or 10 GB), so a
// resync of an older session reads no capture. Two values come only from it:
//
//   the race length (LMU: raceLength.mjs reads it from the scoring stream), and
//   the car's damage, which tells a repair or a stop-go from a service
//   (pitVisit.mjs `repaired`).
//
// Without it a fresh run writes race null and reads a repair as a service or
// unknown. The field is kept the same way (field.mjs fieldAfterSync): a stored
// value is replaced by a new one, never by the absence of one.

/** The stored race length, when this run had none and the session is an LMU race. */
export function raceAfterSync(fresh, stored, {sim, sessionType}) {
  if (fresh) return fresh;
  if (sim !== 'lmu' || !/^r/i.test(sessionType ?? '')) return fresh ?? null;
  return stored ?? null;
}

/**
 * The online flag (gameMode.mjs): a stored value is replaced by a new one,
 * never by the absence of one, since only the capture knows it.
 */
export function onlineAfterSync(fresh, stored) {
  return fresh ?? stored ?? null;
}

/**
 * Whether a stored visit holds a fact only the damage record gives: the stop
 * repaired something, or it was a stop-go (stopped, nothing done, no repair).
 * A visit read without damage can say neither.
 */
export function visitUsedDamage(visit) {
  if (!visit) return false;
  if (visit.kind === 'repair') return true;
  if (Array.isArray(visit.did) && visit.did.includes('repair')) return true;
  return visit.kind === 'penalty' && visit.detail === 'stop-go';
}

/**
 * The visit to write for one stop. `fresh` is this run's, `stored` the lap
 * doc's. When this run had no damage record, a stored visit built from damage
 * stays; every other case takes the fresh one, so a rule change still lands.
 */
export function visitAfterSync(fresh, stored, {damageMissing}) {
  if (!damageMissing || !visitUsedDamage(stored)) return fresh;
  if (visitUsedDamage(fresh)) return fresh;
  return stored;
}

/**
 * Apply visitAfterSync to every lap with a stop; `storedLaps` maps lap id to
 * the stored lap doc. Mutates the laps, returns how many visits were kept.
 */
export function keepVisits(laps, storedLaps, {damageMissing}) {
  let kept = 0;
  if (!damageMissing) return kept;
  for (const lap of laps) {
    const fresh = lap.pitStop?.visit;
    const stored = storedLaps.get(lap.id)?.pitStop?.visit;
    if (!fresh || !stored) continue;
    const visit = visitAfterSync(fresh, stored, {damageMissing});
    if (visit !== fresh) {
      lap.pitStop = {...lap.pitStop, visit};
      kept++;
    }
  }
  return kept;
}
