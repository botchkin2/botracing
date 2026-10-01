// Which lap makes a fair reference for another lap (pit-wall thread 11, E3).
// A best lap on low fuel is the wrong ruler for a race lap, so candidates are
// ranked on what they have in common with the lap being compared: the same
// car, the same kind of session, a similar fuel load, no fresh tyres, and no
// time off track; then the fastest. A tow or traffic does not rank a lap
// (Botkin, pit-wall thread 44 #1789: they are flags beside a number, never a
// filter). Numbers and matches only, no verdict.
// Pure: imports nothing.

export type RefLap = {
  id: string;
  /** The session the lap is from; the pool spans sessions of one track. */
  sessionId: string;
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
  /** Virtual Energy on board at the start of the lap, %; null without the channel. */
  veStartPct: number | null;
};

/** Fuel loads this close count as one band: a lap's weight moves its time by hundredths. */
export const FUEL_BAND_L = 10;
/** The same band in Virtual Energy points, where the fuel level is not known on both laps. */
export const VE_BAND_PCT = 10;

export type RefMatch = {
  sameCar: boolean;
  sameSession: boolean;
  /**
   * Within `FUEL_BAND_L` of the compared lap's fuel; where either lap has no
   * fuel level, within `VE_BAND_PCT` of its Virtual Energy; false when
   * neither is known on both.
   */
  fuelBand: boolean;
  /** No new tyres on the candidate lap. */
  tyresKept: boolean;
  /** No time off track on the candidate lap. */
  onTrack: boolean;
};

export type RankedRef = {
  lapId: string;
  sessionId: string;
  timeS: number;
  match: RefMatch;
};

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

// Fuel is the weight, so it decides when both laps have it; the energy
// fallback covers laps recorded without a fuel channel.
function inLoadBand(lap: RefLap, target: RefLap): boolean {
  if (lap.startL != null && target.startL != null)
    return Math.abs(lap.startL - target.startL) <= FUEL_BAND_L;
  if (lap.veStartPct != null && target.veStartPct != null)
    return Math.abs(lap.veStartPct - target.veStartPct) <= VE_BAND_PCT;
  return false;
}

function matchOf(lap: RefLap, target: RefLap): RefMatch {
  return {
    sameCar: lap.car === target.car,
    sameSession: lap.sessionType === target.sessionType,
    fuelBand: inLoadBand(lap, target),
    tyresKept: !lap.newTyres,
    onTrack: lap.offTrackS === 0,
  };
}

// Most important first: a different car is a different ruler whatever the
// fuel, a different kind of session next, then the load, the tyres, the line.
const ORDER: (keyof RefMatch)[] = [
  'sameCar',
  'sameSession',
  'fuelBand',
  'tyresKept',
  'onTrack',
];

/**
 * The candidates that could be a reference for `target`, best first: those
 * that match on the most important things, and within equal matches the
 * fastest. Ineligible laps are left out.
 *
 * Within one session every lap has the same car and session type, so those
 * two keys only separate laps once other sessions join the pool (the same
 * track is the pool's precondition, `crossSessionReferences`).
 */
export function rankReferenceLaps(
  target: RefLap,
  candidates: RefLap[],
): RankedRef[] {
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
      // The band decides what is fair; inside it the fastest wins. Ordering
      // by fuel distance as well would pick the lap beside the target.
      return a.timeS - b.timeS || a.lap.id.localeCompare(b.lap.id);
    })
    .map(({lap, timeS, match}) => ({
      lapId: lap.id,
      sessionId: lap.sessionId,
      timeS,
      match,
    }));
}
