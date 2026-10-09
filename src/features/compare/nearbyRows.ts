import {type ClassSlot, type ClassTable} from '@/src/analysis/fieldClasses';
import {updateAt} from '@/src/analysis/field';
import {type NearbyCar, nearbyCars} from '@/src/analysis/nearbyCars';
import {type RaceClock} from '@/src/analysis/raceClock';
import {type RacePrep} from '@/src/analysis/raceState';
import {formatGap} from '@/src/design';

// CARS AROUND for a field with no positions (iRacing's, pit-wall thread 1
// #3209 to #3211): the cars nearest you ahead and behind on the road at
// Compare's cursor, as rows. Pure: the field and the cursor in, rows out.

export interface NearbyRow {
  index: number;
  slot: ClassSlot;
  short: string;
  /** The car model, else the class label. */
  label: string;
  /** "+1.2 s" ahead, "−0.8 s" behind; "" when no time is known and in the pit lane. */
  gapText: string;
  /** "+123 m" / "−45 m". */
  metresText: string;
  /** "+1L" / "−1L" for a car a lap up or down; "" on your lap. */
  lapsText: string;
  /** In the pit lane: drawn dimmed. */
  pit: boolean;
}

export interface NearbyView {
  ahead: NearbyRow[];
  behind: NearbyRow[];
  /** The 5 Hz sample the list is for. */
  timeS: number;
}

const signed = (v: number, text: string) => `${v < 0 ? '−' : '+'}${text}`;

export function nearbyRow(car: NearbyCar): NearbyRow {
  return {
    index: car.index,
    slot: car.slot,
    short: car.short,
    label: car.vehicle ?? car.classLabel,
    // A car in the pit lane is not racing you: its time to your spot is not a gap.
    gapText:
      car.pit || car.intervalS == null
        ? ''
        : `${formatGap(car.intervalS, 1)} s`,
    metresText: signed(car.metres, `${Math.abs(Math.round(car.metres))} m`),
    lapsText:
      car.lapsUp === 0 ? '' : signed(car.lapsUp, `${Math.abs(car.lapsUp)}L`),
    pit: car.pit,
  };
}

/**
 * The list at the cursor: `perSide` cars each way (pit-lane cars not
 * counted). Null where the field does not cover the cursor or you are not on
 * the road then.
 */
export function nearbyAtCursor(
  prep: RacePrep,
  clock: RaceClock,
  lapNumber: number,
  cursorM: number,
  classes: ClassTable,
  perSide: number,
  race: boolean,
): NearbyView | null {
  const t = clock.timeAtLapDistance(lapNumber, cursorM);
  if (t == null) return null;
  const {field} = prep;
  const at = updateAt(field.timeS, Math.floor(t * field.hz) / field.hz);
  const near = nearbyCars(prep, at, classes, perSide, race);
  if (!near) return null;
  return {
    ahead: near.ahead.map(nearbyRow),
    behind: near.behind.map(nearbyRow),
    timeS: field.timeS[at],
  };
}
