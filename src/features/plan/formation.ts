// What the formation lap burns, from the driver's own races (pit-wall thread
// 54 #2572, 99). A race's first lap doc holds the formation and racing lap 1
// together in LMU (lap 1 counts from the green, behind the line: analysis/
// lapNumbering.ts): Silverstone 15 Oct 4.62 L = 0.86 L to the green + 3.76 L
// for L1. The uploader stores the formation alone (planBlock.mjs formationOf)
// and the plan charges it on top of the race laps. Pure.
import {
  FORMATION_FUEL_ESTIMATE,
  type FormationFactor,
} from '@/src/analysis/fuelPlan';
import {median} from '@/src/analysis/setStats';

/** Races needed before the burn is measured rather than estimated. */
export const MIN_FORMATION_RACES = 2;

export type FormationBurn = {
  /** Laps of use per meter on top of the race laps, for the plan's rules. VE is none: it does not move before the green (Silverstone, Sebring). */
  factor: FormationFactor;
  kind: 'measured' | 'estimate';
  /** Races the measurement is from; 0 for an estimate. */
  races: number;
  /** The median burn in litres when measured. */
  burnL: number | null;
};

/**
 * The median formation burn over the driver's races at this track and car, in
 * median green laps of fuel. Under MIN_FORMATION_RACES races, or with no green
 * median to compare with, FORMATION_FUEL_ESTIMATE, marked as an estimate.
 */
export function formationBurnOf(
  /** Each race's formation burn (`plan.race.formationL`, the formation alone); null where it has none. */
  raceBurnsL: (number | null)[],
  greenFuelL: number | null,
): FormationBurn {
  const burns = raceBurnsL.flatMap(b => (b != null && b > 0 ? [b] : []));
  if (
    burns.length >= MIN_FORMATION_RACES &&
    greenFuelL != null &&
    greenFuelL > 0
  ) {
    const burnL = median(burns)!; // burns holds at least MIN_FORMATION_RACES values
    return {
      factor: {fuel: burnL / greenFuelL, ve: 0},
      kind: 'measured',
      races: burns.length,
      burnL,
    };
  }
  return {
    factor: {fuel: FORMATION_FUEL_ESTIMATE, ve: 0},
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
