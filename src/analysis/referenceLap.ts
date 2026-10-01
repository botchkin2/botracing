// Which lap makes a fair reference for another lap (pit-wall thread 11, E3).
// A best lap on low fuel is the wrong ruler for a race lap, so candidates are
// ranked on what they have in common with the lap being compared: the same
// car, the same kind of session, a similar fuel load, no fresh tyres, and
// clean air; then the fastest. Numbers and matches only, no verdict.
// Pure: imports nothing.

export type RefLap = {
  id: string;
  /** The car model, not the livery (`carLabel(car).model`). */
  car: string;
  /** R, Q or P. */
  sessionType: string;
  timeS: number | null;
  comparable: boolean;
  partial: boolean;
  pitIn: boolean;
  pitOut: boolean;
  endedInReset: boolean;
  hadImpact: boolean;
  offTrackS: number;
  /** The tyre wear reading jumped at the start of this lap (a set or a wheel replaced). */
  newTyres: boolean;
  /** Fuel on board at the start of the lap, litres; null without the channel. */
  startL: number | null;
  /** Seconds within about 1 s of a car ahead; null without a field. */
  trafficAheadS: number | null;
  /** Seconds under the blue flag; null without a field. */
  blueFlagS: number | null;
};

/** Fuel loads this close count as one band: a lap's weight moves its time by hundredths. */
export const FUEL_BAND_L = 10;
/** Traffic ahead and blue flag below this many seconds is clean air. */
export const CLEAN_AIR_S = 1;

export type RefMatch = {
  sameCar: boolean;
  sameSession: boolean;
  /** Within `FUEL_BAND_L` of the compared lap's fuel; false when either is unknown. */
  fuelBand: boolean;
  /** No new tyres on the candidate lap. */
  tyresKept: boolean;
  /** No traffic ahead, blue flag or off-track on the candidate lap; a lap without a field is clean on what is known. */
  clean: boolean;
};

export type RankedRef = {lapId: string; timeS: number; match: RefMatch};

/** A lap that can be a reference at all: timed, whole, on the racing line, and not the lap itself. */
function eligible(lap: RefLap, target: RefLap): boolean {
  return (
    lap.id !== target.id &&
    lap.comparable &&
    !lap.partial &&
    !lap.pitIn &&
    !lap.pitOut &&
    !lap.endedInReset &&
    !lap.hadImpact
  );
}

function matchOf(lap: RefLap, target: RefLap): RefMatch {
  return {
    sameCar: lap.car === target.car,
    sameSession: lap.sessionType === target.sessionType,
    fuelBand:
      lap.startL != null &&
      target.startL != null &&
      Math.abs(lap.startL - target.startL) <= FUEL_BAND_L,
    tyresKept: !lap.newTyres,
    clean:
      (lap.trafficAheadS ?? 0) < CLEAN_AIR_S &&
      (lap.blueFlagS ?? 0) < CLEAN_AIR_S &&
      lap.offTrackS === 0,
  };
}

// Most important first: a different car is a different ruler whatever the
// fuel, a different kind of session next, then the load, the tyres, the air.
const ORDER: (keyof RefMatch)[] = [
  'sameCar',
  'sameSession',
  'fuelBand',
  'tyresKept',
  'clean',
];

/**
 * The candidates that could be a reference for `target`, best first: those
 * that match on the most important things, and within equal matches the
 * closest fuel load, then the fastest. Ineligible laps are left out.
 */
export function rankReferenceLaps(
  target: RefLap,
  candidates: RefLap[],
): RankedRef[] {
  const fuelGap = (lap: RefLap) =>
    lap.startL != null && target.startL != null
      ? Math.abs(lap.startL - target.startL)
      : Infinity;
  const timed = candidates.flatMap(lap =>
    lap.timeS != null && eligible(lap, target)
      ? [{lap, timeS: lap.timeS, match: matchOf(lap, target)}]
      : [],
  );
  return timed
    .sort((a, b) => {
      for (const key of ORDER) {
        if (a.match[key] !== b.match[key]) return a.match[key] ? -1 : 1;
      }
      return (
        fuelGap(a.lap) - fuelGap(b.lap) ||
        a.timeS - b.timeS ||
        a.lap.id.localeCompare(b.lap.id)
      );
    })
    .map(({lap, timeS, match}) => ({lapId: lap.id, timeS, match}));
}
