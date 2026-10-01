// The traffic block of every lap, from a field: the seconds and counts of
// fieldTags.mjs plus the faster-class cars that passed the player
// (src/analysis/traffic.ts), stamped with TRAFFIC_VERSION.
import {paceOf} from '../../src/analysis/classLaps.ts';
import {overtakesOf, TRAFFIC_VERSION} from '../../src/analysis/traffic.ts';
import {lapFieldFacts} from './fieldTags.mjs';

// windows: [{from, to}] on the session clock. One block per window, null when
// the field has no player car.
export function lapTraffic(field, windows) {
  const facts = lapFieldFacts(field, windows);
  const overtakes = overtakesOf(field, windows, paceOf);
  return facts.map((f, k) =>
    f ? {...f, v: TRAFFIC_VERSION, overtakes: overtakes[k]} : null,
  );
}

// Which field the blocks are read from. The capture folder is pruned after 7
// days, so a resync without it must not wipe what was found while it was
// there: with no fresh field, the uploaded one is read (`load` returns it, or
// null when it cannot be read, and the next sync tries again).
export async function lapTrafficFrom({fresh, stored, load, windows}) {
  const field = fresh ?? (stored ? await load() : null);
  return field ? lapTraffic(field, windows) : windows.map(() => null);
}
