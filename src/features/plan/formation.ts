// What the formation lap burns, from the driver's own races (pit-wall thread
// 54 #2572). The grid procedure (a slow lap, then a rolling start from pit
// exit) burns more fuel than a green lap: 3.27 and 3.54 L against a 2.43 L
// median on the two Road Atlanta races of the accuracy review. So the plan
// charges the measured burn, not one median lap. Pure.
import {
  FORMATION_FUEL_ESTIMATE,
  type FormationFactor,
} from '@/src/analysis/fuelPlan';
import type {Lap} from '@/src/data/sessions';

/** Races needed before the burn is measured rather than estimated. */
export const MIN_FORMATION_RACES = 2;

export type FormationBurn = {
  /** Laps of use per meter, for the plan's rules. VE stays at one lap: it matched one green lap where it was checked. */
  factor: FormationFactor;
  kind: 'measured' | 'estimate';
  /** Races the measurement is from; 0 for an estimate. */
  races: number;
  /** The median burn in litres when measured. */
  burnL: number | null;
};

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** A race's formation burn: the fuel the first lap used, from the first sample to the start line. */
function burnOf(laps: Lap[]): number | null {
  if (laps.length === 0) return null;
  const first = laps.reduce((a, b) => (b.lapIndex < a.lapIndex ? b : a));
  const used = first.fuel?.usedL;
  return used != null && used > 0 ? used : null;
}

/**
 * The median first-lap burn over the driver's races at this track and car,
 * against one median green lap of fuel. Under MIN_FORMATION_RACES races, or
 * with no green median to compare with, 1.4 laps (the ratio seen on the two
 * fixtures), marked as an estimate.
 */
export function formationBurnOf(
  races: Lap[][],
  greenFuelL: number | null,
): FormationBurn {
  const burns = races.flatMap(laps => {
    const b = burnOf(laps);
    return b == null ? [] : [b];
  });
  if (
    burns.length >= MIN_FORMATION_RACES &&
    greenFuelL != null &&
    greenFuelL > 0
  ) {
    const burnL = median(burns);
    return {
      factor: {fuel: burnL / greenFuelL, ve: 1},
      kind: 'measured',
      races: burns.length,
      burnL,
    };
  }
  return {
    factor: {fuel: FORMATION_FUEL_ESTIMATE, ve: 1},
    kind: 'estimate',
    races: 0,
    burnL: null,
  };
}

/** The Formation cell of the rules: the measured burn, or the estimate named as one. */
export function formationText(b: FormationBurn): string {
  return b.kind === 'measured' && b.burnL != null
    ? `${b.burnL.toFixed(1)} L · ${b.races} races`
    : `${b.factor.fuel.toFixed(1)} laps of fuel · estimate`;
}
