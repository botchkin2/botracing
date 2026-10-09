// The cars nearest you on the road at one update, for a field with no world
// positions (iRacing's): who is ahead and behind by lap distance, how far in
// metres and in seconds, and whether they are on your lap (pit-wall thread 1
// #3209 to #3211). Pure.
//
// The seconds are the real interval, as a timing screen gives it: for a car
// ahead, how long ago it passed the spot where you are now; for a car behind,
// how long until it reaches it. They come from each car's own history, so they
// hold through braking zones, where metres over speed is far off. Metres over
// your speed is the fallback only when the field does not cover the crossing.
import {classOfCar, type ClassSlot, type ClassTable} from './fieldClasses';
import {type RacePrep} from './raceState';

export interface NearbyCar {
  /** Index in Field.cars. */
  index: number;
  slot: ClassSlot;
  /** The class's short label, beside its colour. */
  short: string;
  /** The class's label, for a car with no model. */
  classLabel: string;
  vehicle: string | null;
  /** Ahead (+) or behind (−) on the road, metres. */
  metres: number;
  /** Ahead (+) or behind (−), seconds; null when neither the history nor a speed gives one. */
  intervalS: number | null;
  /** Whole laps the car is ahead of you (+1) or behind (−1); 0 on your lap, and always 0 outside a race. */
  lapsUp: number;
  /** In the pit lane: shown dimmed, and not counted in `perSide`. */
  pit: boolean;
}

export interface NearbyCars {
  /** Nearest first. */
  ahead: NearbyCar[];
  behind: NearbyCar[];
}

/** Below this you are standing still, and metres over speed is not a time. */
const MOVING_KMH = 5;

/**
 * When the car's progress was last below and then at `progressM`, up to
 * update `upTo`, by linear interpolation; null when the field has no reading
 * of it below that point (it was already past it when first seen).
 */
function timePassed(
  prep: RacePrep,
  car: number,
  progressM: number,
  upTo: number,
): number | null {
  const prog = prep.progressM[car];
  const times = prep.field.timeS;
  let after = -1;
  for (let u = upTo; u >= 0; u--) {
    const p = prog[u];
    if (Number.isNaN(p)) continue;
    if (p >= progressM) {
      after = u;
      continue;
    }
    if (after < 0) return null;
    const span = prog[after] - p;
    const f = span > 0 ? (progressM - p) / span : 1;
    return times[u] + f * (times[after] - times[u]);
  }
  return null;
}

/**
 * When the car's progress reaches `progressM` after update `from`, by linear
 * interpolation; null if it never does in the field.
 */
function timeReaching(
  prep: RacePrep,
  car: number,
  progressM: number,
  from: number,
): number | null {
  const prog = prep.progressM[car];
  const times = prep.field.timeS;
  let before = -1;
  for (let u = from; u < prog.length; u++) {
    const p = prog[u];
    if (Number.isNaN(p)) continue;
    if (p < progressM) {
      before = u;
      continue;
    }
    if (before < 0) return null;
    const span = p - prog[before];
    const f = span > 0 ? (progressM - prog[before]) / span : 1;
    return times[before] + f * (times[u] - times[before]);
  }
  return null;
}

/** Your speed at `at` from your progress over the update before it, km/h; NaN without one. */
function speedAt(prep: RacePrep, car: number, at: number): number {
  const prog = prep.progressM[car];
  const times = prep.field.timeS;
  for (let u = at - 1; u >= 0; u--) {
    if (Number.isNaN(prog[u])) continue;
    const dt = times[at] - times[u];
    return dt > 0 ? ((prog[at] - prog[u]) / dt) * 3.6 : NaN;
  }
  return NaN;
}

/**
 * The `perSide` nearest cars ahead and behind you at update `at`, pit-lane
 * cars among them (dimmed, not counted). Null without you on the road there
 * or without a track length.
 */
export function nearbyCars(
  prep: RacePrep,
  at: number,
  classes: ClassTable,
  perSide: number,
  /** Laps up and down mean something only in a race: elsewhere each car's lap counter is its own. */
  race: boolean,
): NearbyCars | null {
  const {field, trackM} = prep;
  const me = field.cars.findIndex(c => c.player);
  if (me < 0 || !(trackM > 0) || at < 0 || at >= field.timeS.length)
    return null;
  const mine = prep.progressM[me][at];
  if (Number.isNaN(mine) || field.cars[me].inPits[at] === 1) return null;
  const now = field.timeS[at];
  const mySpeed = speedAt(prep, me, at);

  const all: NearbyCar[] = [];
  field.cars.forEach((car, i) => {
    if (i === me) return;
    const theirs = prep.progressM[i][at];
    if (Number.isNaN(theirs)) return;
    // Road offset: the lap-distance difference folded into ±half a lap.
    const diff = theirs - mine;
    const lapsAway = Math.round(diff / trackM);
    const metres = diff - lapsAway * trackM;
    // Where the car was (ahead) or will be (behind) at your spot on the road.
    const atYourSpot = theirs - metres;
    const crossing =
      metres >= 0
        ? timePassed(prep, i, atYourSpot, at)
        : timeReaching(prep, i, atYourSpot, at);
    const intervalS =
      crossing != null
        ? now - crossing
        : mySpeed > MOVING_KMH
        ? metres / (mySpeed / 3.6)
        : null;
    const cls = classes.of(classOfCar(car).key);
    all.push({
      index: i,
      slot: cls.slot,
      short: cls.short,
      classLabel: cls.label,
      vehicle: car.vehicle,
      metres,
      intervalS,
      lapsUp: race ? lapsAway : 0,
      pit: car.inPits[at] === 1,
    });
  });

  const side = (list: NearbyCar[]) => {
    const out: NearbyCar[] = [];
    let counted = 0;
    for (const c of list.sort(
      (a, b) => Math.abs(a.metres) - Math.abs(b.metres),
    )) {
      if (counted >= perSide) break;
      out.push(c);
      if (!c.pit) counted++;
    }
    return out;
  };
  return {
    ahead: side(all.filter(c => c.metres >= 0)),
    behind: side(all.filter(c => c.metres < 0)),
  };
}
