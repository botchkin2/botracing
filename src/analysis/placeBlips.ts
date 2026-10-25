// The game's overall place, steadied for a replay (pit-wall thread 109, ticket 54). LMU's own `place` blips: for one
// update a car reads the wrong place and the next one it is back. At the green a car that has just crossed the line
// (lap still 0, distance wrapped) reads last while the cars behind it read one place up; later in a race the same happens
// at every line crossing, and neighbours swap for one update at a time. A replay holds the whole series, so a blip is
// seen by looking ahead: no delay, nothing guessed. The field's own `place` is never changed; this is a derived series.
//
// Plain TypeScript with erasable syntax; Node can run it.

import {ABSENT} from './field.ts';

/**
 * A departure from the place the car had that is over within `maxTicks` updates, back to that same place, is a blip and
 * takes the place it came from. Left to right, so a 7,6,7,6 chain settles on one value, and a blip of several places
 * (2,2,1,1,9,2) goes as one. ABSENT is never filled and ends a look-ahead; a change at the start or the end of the
 * series has no place to come back from or to and is kept. A real overtake that holds longer than `maxTicks` is kept
 * as it is.
 */
export function steadyPlace(place: Int16Array, maxTicks: number): Int16Array {
  const out = Int16Array.from(place);
  const n = place.length;
  let u = 1;
  while (u < n) {
    const from = out[u - 1];
    if (place[u] === from || place[u] === ABSENT || from === ABSENT) {
      u++;
      continue;
    }
    let back = -1;
    for (let k = u + 1; k < n && k <= u + maxTicks; k++) {
      if (place[k] === ABSENT) break;
      if (place[k] === from) {
        back = k;
        break;
      }
    }
    if (back < 0) {
      u++;
      continue;
    }
    out.fill(from, u, back);
    u = back;
  }
  return out;
}

/** A blip as the room counts it: a place that changes and comes back within `withinTicks` updates. */
export function countBlips(place: Int16Array, withinTicks: number): number {
  let blips = 0;
  const n = place.length;
  for (let u = 1; u < n; u++) {
    if (place[u] === place[u - 1] || place[u - 1] === ABSENT || place[u] === ABSENT) continue;
    for (let k = u + 1; k < n && k <= u + withinTicks; k++) {
      if (place[k] === place[u - 1]) {
        blips++;
        break;
      }
      if (place[k] === ABSENT) break;
    }
  }
  return blips;
}
