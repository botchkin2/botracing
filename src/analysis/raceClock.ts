// One clock for Race and Compare: the player's place on the lap at a race
// time, and the race time of a place on a lap. Plain TypeScript, erasable
// syntax only: Node runs it.
//
// Race time is seconds from the field's first update. A place is the game's
// laps-completed count (the lap docs' `lapNumber`; 0 is the first lap) and the
// distance along that lap, in metres.
//
// `raceClock(field)` does the per-field work once (lap numbers, lap runs);
// keep the result for as long as the field lives and call it per frame.
import {trackLengthM} from './classLaps';
import {ABSENT, type Field, type FieldCar, updateAt} from './field';

export interface LapPlace {
  lapNumber: number;
  distanceM: number;
}

export interface RaceClock {
  /** The player at the update nearest `timeS`; null with no player or when absent then. */
  playerAt(timeS: number): LapPlace | null;
  /**
   * Race time at which the player was `distanceM` into lap `lapNumber`, by
   * linear interpolation between updates (from the previous lap's last sample
   * for a distance before the lap's first one); null when the player never
   * drove that lap or never got that far on it (a lap that ended in the pits,
   * a reset).
   */
  timeAtLapDistance(lapNumber: number, distanceM: number): number | null;
}

/** A stretch of consecutive updates on one lap with the player present. */
interface Run {
  first: number;
  last: number;
}

const NONE: RaceClock = {
  playerAt: () => null,
  timeAtLapDistance: () => null,
};

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
    if (trackM === 0) {
      lap = car.lapsDone[u];
      laps[u] = lap;
      before = d;
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

export function raceClock(field: Field): RaceClock {
  const car = field.cars.find(c => c.player);
  if (!car) return NONE;
  const trackM = trackLengthM(field.cars.map(c => [...c.lapDistM]));
  const laps = lapsOf(car, trackM);
  const runs = new Map<number, Run[]>();
  for (let u = 0; u < laps.length; u++) {
    if (laps[u] === ABSENT) continue;
    const list = runs.get(laps[u]) ?? [];
    runs.set(laps[u], list);
    const tail = list[list.length - 1];
    if (tail && tail.last === u - 1) tail.last = u;
    else list.push({first: u, last: u});
  }

  return {
    playerAt(timeS) {
      const u = updateAt(field.timeS, timeS);
      if (u < 0 || laps[u] === ABSENT) return null;
      return {lapNumber: laps[u], distanceM: car.lapDistM[u]};
    },

    timeAtLapDistance(lapNumber, distanceM) {
      for (const run of runs.get(lapNumber) ?? []) {
        // Distance grows along a run, so the first update at or past it can
        // be found by halving.
        let lo = run.first;
        let hi = run.last;
        if (car.lapDistM[hi] < distanceM) continue;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (car.lapDistM[mid] < distanceM) lo = mid + 1;
          else hi = mid;
        }
        const at = car.lapDistM[lo];
        let from = lo - 1;
        let fromD = from >= run.first ? car.lapDistM[from] : NaN;
        // Before the lap's first sample: the last sample of the lap before,
        // if it is the update just ahead of this run.
        if (
          trackM > 0 &&
          lo === run.first &&
          lo > 0 &&
          laps[lo - 1] === lapNumber - 1
        ) {
          from = lo - 1;
          fromD = car.lapDistM[from] - trackM;
        }
        if (Number.isNaN(fromD)) return field.timeS[lo];
        const span = at - fromD;
        const f = span > 0 ? (distanceM - fromD) / span : 1;
        return field.timeS[from] + f * (field.timeS[lo] - field.timeS[from]);
      }
      return null;
    },
  };
}
