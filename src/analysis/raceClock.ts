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
// from the last update that was away from it, but only a wrap the counter
// confirms within CONFIRM_S. A wrap it never confirms is the line crossed
// without completing a lap: the end of the formation lap onto the grid, and
// the start from a grid behind the line (LMU and iRacing count neither; his
// 2026-10-15 Silverstone race: mTotalLaps stays 0 from the grid until the
// first full lap, pit wall thread 91). Such a wrap restarts the lap's run.
const CONFIRM_S = 2;

function lapsOf(
  car: FieldCar,
  trackM: number,
  hz: number,
): {laps: Int32Array; restart: Uint8Array} {
  const n = car.lapDistM.length;
  const laps = new Int32Array(n);
  const restart = new Uint8Array(n);
  const window = Math.max(1, Math.ceil(CONFIRM_S * hz));
  const counted = (u: number, lap: number) => {
    for (let k = Math.max(0, u - window); k <= Math.min(n - 1, u + window); k++)
      if (car.lapsDone[k] !== ABSENT && car.lapsDone[k] >= lap) return true;
    return false;
  };
  let lap = 0;
  let before = NaN;
  // A confirmed wrap is what makes the counter trustworthy away from the line.
  // Before that, a counter already reading 1 at the green flag is not a
  // completed racing lap (Daytona 10-07): copying it puts lap 2 a quarter of
  // a lap after the start.
  let synced = false;
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
    if (!nearLine || Number.isNaN(before)) {
      if (
        car.lapsDone[u] !== ABSENT &&
        (Number.isNaN(before) || synced || car.lapsDone[u] <= lap)
      )
        lap = car.lapsDone[u];
    } else if (before > trackM * 0.75 && d < trackM * 0.25) {
      if (counted(u, lap + 1)) {
        lap++;
        synced = true;
      } else restart[u] = 1;
    }
    laps[u] = lap;
    before = d;
  }
  return {laps, restart};
}

export function raceClock(field: Field): RaceClock {
  const car = field.cars.find(c => c.player);
  if (!car) return NONE;
  return carClock(
    field,
    car,
    trackLengthM(field.cars.map(c => [...c.lapDistM])),
  );
}

/**
 * The race's start, in race time: the first car to cross the line on its
 * first lap (the front of the grid). The green flag itself (mGamePhase 5) is
 * in the capture but not in the stored field, so the first crossing stands
 * in for it, 0.2 to 4 s after green in his eight LMU race captures. A car's
 * start is its last unconfirmed wrap on lap 0 (lapsOf), counted only when it
 * goes on to complete that lap; from a grid behind the line (negative lap
 * distance) the crossing is the first update past 0 after it. Null when no
 * car's start is in the field (a field that begins mid-race).
 */
export function raceStartS(field: Field): number | null {
  const trackM = trackLengthM(field.cars.map(c => [...c.lapDistM]));
  if (trackM === 0) return null;
  let first: number | null = null;
  for (const car of field.cars) {
    const t = startCrossingS(field, car, trackM);
    if (t !== null && (first === null || t < first)) first = t;
  }
  return first;
}

function startCrossingS(
  field: Field,
  car: FieldCar,
  trackM: number,
): number | null {
  const {laps, restart} = lapsOf(car, trackM, field.hz);
  let r = -1;
  let completed = false;
  for (let u = 0; u < laps.length; u++) {
    if (laps[u] === 0 && restart[u]) r = u;
    if (laps[u] >= 1 && laps[u] !== ABSENT && r >= 0) {
      completed = true;
      break;
    }
  }
  if (!completed) return null;
  const d = car.lapDistM;
  // The update at or past the line, and the one before it (in lap metres
  // from the line, negative behind it).
  let u = r;
  let before = d[r - 1] - trackM;
  if (d[r] < 0) {
    while (u < laps.length && !(d[u] >= 0)) u++;
    if (u >= laps.length) return null;
    before = d[u - 1];
  }
  const t = field.timeS;
  if (u === 0 || !(d[u] > before)) return t[u];
  return t[u - 1] + (-before / (d[u] - before)) * (t[u] - t[u - 1]);
}

function carClock(field: Field, car: FieldCar, trackM: number): RaceClock {
  const {laps, restart} = lapsOf(car, trackM, field.hz);
  const runs = new Map<number, Run[]>();
  for (let u = 0; u < laps.length; u++) {
    if (laps[u] === ABSENT) continue;
    // An unconfirmed wrap (lapsOf) starts the lap over: what came before it
    // (the formation lap) is not that lap.
    if (restart[u]) runs.set(laps[u], []);
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
