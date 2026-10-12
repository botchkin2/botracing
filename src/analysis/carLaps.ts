// One car's laps from the recorded 5 Hz field, for the Race screen's per-car
// panel (roadmap D55). The lap clock is classLaps' `walkCarLaps` (the line
// crossings found where lap distance wraps), so the class pace and these rows
// are the same laps. Every time here is approximate: the field has no lap
// times, only positions at 5 Hz (the crossing is interpolated, within about
// 0.1 s). Pure.
import {trackLengthM, walkCarLaps} from './classLaps';
import {type Field} from './field';

/** How a lap touched the pit lane: it ended in the pits, began in them, or was in them in between. */
export type CarLapPit = 'in' | 'out' | 'pit';

export interface CarLap {
  /** Laps completed when it ended (the sim's counter); null when the counter is not recorded. */
  lapNumber: number | null;
  /** Seconds; null when the car left the field during the lap, so it cannot be timed. */
  timeS: number | null;
  pit: CarLapPit | null;
}

/**
 * The app's lap number is the player's lap list position (`lapIndex = i + 1`).
 * LMU's laps counter, read at the end of a lap, is that number. iRacing's
 * counter runs one behind (Sebring practice: counter 6 is the app's L7), so
 * its laps add one. The sims are told apart as everywhere else: iRacing has
 * no world positions (`Field.hasPositions`).
 */
export function lapLabelOffset(field: Pick<Field, 'hasPositions'>): number {
  return field.hasPositions ? 0 : 1;
}

/**
 * The laps `carIndex` completed, in order. The first line crossing only starts
 * the clock, so a car's partial first lap is not listed; a car that joined
 * mid-session is timed from its first crossing on. A lap the walk could not
 * time (the counter shows it was driven: a missed crossing, a jump, the car
 * absent) is a row with a null time, so every lap between the first and last
 * listed is accounted for. Empty when no car in the field wrapped (the track
 * length is unknown) or the index is not a car.
 */
export function carLapsOf(field: Field, carIndex: number): CarLap[] {
  const car = field.cars[carIndex];
  if (!car) return [];
  const lengthM = trackLengthM(field.cars.map(c => c.lapDistM));
  if (lengthM === 0) return [];
  const {laps} = walkCarLaps(car.lapDistM, car.inPits, field.timeS, lengthM);
  const last = car.lapsDone.length - 1;
  const offset = lapLabelOffset(field);
  const out: CarLap[] = [];
  for (const l of laps) {
    // The counter can step an update either side of the wrap; the update
    // after the crossing's has seen it step in both cases.
    const done = car.lapsDone[Math.min(l.endUpdate + 1, last)];
    const lapNumber = done !== undefined && done > 0 ? done + offset : null;
    const before = out.length > 0 ? out[out.length - 1].lapNumber : null;
    if (lapNumber !== null && before !== null)
      for (let n = before + 1; n < lapNumber; n++)
        out.push({lapNumber: n, timeS: null, pit: null});
    let pit: CarLapPit | null = null;
    if (l.pit || l.startInPit || l.endInPit) {
      if (l.endInPit && !l.startInPit) pit = 'in';
      else if (l.startInPit && !l.endInPit) pit = 'out';
      else pit = 'pit';
    }
    out.push({lapNumber, timeS: l.gap ? null : l.endT - l.startT, pit});
  }
  return out;
}
