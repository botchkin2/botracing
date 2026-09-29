// One clock for Race and Compare: the player's place on the lap at a race
// time, and the race time of a place on a lap. Plain TypeScript, erasable
// syntax only: Node runs it.
//
// Race time is seconds from the field's first update. A place is the game's
// laps-completed count (the lap docs' `lapNumber`; 0 is the first lap) and the
// distance along that lap, in metres.
import {ABSENT, type Field, type FieldCar, updateAt} from './field';

export interface LapPlace {
  lapNumber: number;
  distanceM: number;
}

function playerOf(field: Field): FieldCar | null {
  return field.cars.find(c => c.player) ?? null;
}

// The game bumps laps-completed and resets the lap distance at slightly
// different updates, so at the line the pair can disagree by a whole lap.
// Away from the line the counter is right; near it, count the distance wraps
// from the last update that was away from it.
function lapsOf(car: FieldCar, trackM: number): Int32Array {
  const n = car.lapDistM.length;
  const laps = new Int32Array(n);
  let lap = 0;
  let before = NaN;
  for (let u = 0; u < n; u++) {
    const d = car.lapDistM[u];
    if (Number.isNaN(d)) {
      laps[u] = ABSENT;
      before = NaN;
      continue;
    }
    const nearLine = d < trackM * 0.25 || d > trackM * 0.75;
    if (!nearLine || Number.isNaN(before)) lap = car.lapsDone[u];
    else if (before > trackM * 0.75 && d < trackM * 0.25) lap++;
    laps[u] = lap;
    before = d;
  }
  return laps;
}

function trackLength(car: FieldCar): number {
  let max = 0;
  for (const d of car.lapDistM) if (d > max) max = d;
  return max;
}

/** The player at the update nearest `timeS`; null with no player or when absent then. */
export function playerAt(field: Field, timeS: number): LapPlace | null {
  const car = playerOf(field);
  const u = updateAt(field.timeS, timeS);
  if (!car || u < 0 || Number.isNaN(car.lapDistM[u])) return null;
  return {
    lapNumber: lapsOf(car, trackLength(car))[u],
    distanceM: car.lapDistM[u],
  };
}

/**
 * Race time at which the player was `distanceM` into lap `lapNumber`, by
 * linear interpolation between updates; null when the player never drove that
 * lap or never got that far on it (a lap that ended in the pits, a reset).
 */
export function timeAtLapDistance(
  field: Field,
  lapNumber: number,
  distanceM: number,
): number | null {
  const car = playerOf(field);
  if (!car) return null;
  const laps = lapsOf(car, trackLength(car));
  let prev = -1;
  for (let u = 0; u < field.timeS.length; u++) {
    if (Number.isNaN(car.lapDistM[u]) || laps[u] !== lapNumber) {
      prev = -1;
      continue;
    }
    const d = car.lapDistM[u];
    if (d >= distanceM) {
      if (prev < 0) return field.timeS[u];
      const span = d - car.lapDistM[prev];
      const f = span > 0 ? (distanceM - car.lapDistM[prev]) / span : 1;
      return field.timeS[prev] + f * (field.timeS[u] - field.timeS[prev]);
    }
    prev = u;
  }
  return null;
}
