// The traffic block of every lap, from a field: the seconds and counts of
// fieldTags.mjs plus the faster-class cars that passed the player
// (src/analysis/traffic.ts), stamped with TRAFFIC_VERSION.
import {carsArePhysical} from '../../src/analysis/carsArePhysical.ts';
import {paceOf} from '../../src/analysis/classLaps.ts';
import {overtakesOf, TRAFFIC_VERSION} from '../../src/analysis/traffic.ts';
import {decodeField, fieldLengthM, lapFieldFacts} from './fieldTags.mjs';

// windows: [{from, to}] on the session clock. One block per window, null when
// the field has no player car, and for every window of a qualifying: its other
// cars are not on the track with the player (carsArePhysical), so no lap has
// traffic, tow or passes.
export function lapTraffic(field, windows, session) {
  if (!carsArePhysical(session)) return windows.map(() => null);
  const facts = lapFieldFacts(field, windows);
  const overtakes = overtakesOf(
    field,
    windows,
    paceOf,
    fieldLengthM(decodeField(field).cars),
  );
  return facts.map((f, k) =>
    f ? {...f, v: TRAFFIC_VERSION, overtakes: overtakes[k]} : null,
  );
}

// Which field the blocks are read from. The capture folder is pruned after 7
// days, so a resync without it must not wipe what was found while it was
// there: with no fresh field, the uploaded one is read (`load` returns it, or
// null when it cannot be read, and the next sync tries again).
export async function lapTrafficFrom({fresh, stored, load, windows, session}) {
  // A qualifying has no traffic whatever its field: the uploaded one is not even loaded.
  if (!carsArePhysical(session)) return windows.map(() => null);
  const field = fresh ?? (stored ? await load() : null);
  return field ? lapTraffic(field, windows, session) : windows.map(() => null);
}
