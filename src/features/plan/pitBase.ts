import {type PitModel} from '@/src/analysis/fuelPlan';
import {type RefuelRate, refuelRateOf} from '@/src/analysis/refuel';
import {type PlanStop} from '@/src/data/sessions';

// The pit lane base of a track and car, measured from his own stops there
// (pit-wall thread 36 #1071: a stop is a per-track base plus litres / rate,
// plus 10-15 s when tyres change; there is no stored base; thread 44 #1618).
// What a stop costs the race is the pit LOSS, not the time in the lane: the
// car covers the lane distance anyway, so the loss is the in-lap plus the
// out-lap minus two laps of the stint's median green lap. The uploader works
// the loss out where the laps are (tools/sessions/planBlock.mjs `lossS`, null
// for a stop with no fuel added, changed or unknown tyres, no clean out-lap or
// no stint median), so the Plan needs no lap docs for it. Pure.

/** Fewer measured stops than this is not a base, and the Plan counts no pit time. */
export const MIN_BASE_STOPS = 2;

export type PitBase = {baseS: number; stops: number};

function median(sorted: number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The refuel rate of the history: the pump rate measured on his own race
 * stops here (every visit that added fuel, a repair's included: the pump runs
 * at its own rate whatever else the stop does), else the GT3 default
 * (src/analysis/refuel.ts). `races` are the plan blocks' race sides.
 */
export function refuelRateFor(
  races: {stops: PlanStop[]}[],
  carClass: string,
): RefuelRate | null {
  return refuelRateOf(
    races.flatMap(r => r.stops.map(s => s.fillLPerS)),
    carClass,
  );
}

/**
 * The median of (pit loss - litres added / refuel rate) over the race stops
 * the uploader could measure: services only (planBlock.mjs leaves a repair or a
 * penalty without a loss). Null without a rate, or under MIN_BASE_STOPS stops.
 */
export function pitLaneBase(
  races: {stops: PlanStop[]}[],
  rate: RefuelRate | null,
): PitBase | null {
  if (!rate) return null;
  const bases: number[] = [];
  for (const race of races) {
    for (const stop of race.stops) {
      if (stop.lossS == null || !(stop.addedL != null && stop.addedL > 0))
        continue;
      // A block from before version 2 has no kind; one that does must be a service.
      if (stop.kind != null && stop.kind !== 'service') continue;
      bases.push(stop.lossS - stop.addedL / rate.lPerS);
    }
  }
  if (bases.length < MIN_BASE_STOPS) return null;
  bases.sort((a, b) => a - b);
  return {baseS: Math.max(0, median(bases)), stops: bases.length};
}

/** The model the planner takes; null without a base or a rate. */
export function pitModelOf(
  base: PitBase | null,
  rate: RefuelRate | null,
): PitModel | null {
  return base && rate ? {baseS: base.baseS, refuelLPerS: rate.lPerS} : null;
}
