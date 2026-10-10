import {type PitModel} from '@/src/analysis/fuelPlan';
import {REFUEL_L_PER_S, refuelMeasured} from '@/src/analysis/refuel';
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
 * The median of (pit loss - litres added / refuel rate) over the race stops
 * the uploader could measure. `races` are the plan blocks' race sides of the
 * history, in any order. Null where the refuel rate is not measured for the
 * class, or under MIN_BASE_STOPS stops. The 3.4 L/s rate is `REFUEL_L_PER_S`,
 * measured in thread 34 on 5 stops (src/analysis/refuel.ts).
 */
export function pitLaneBase(
  races: {stops: PlanStop[]}[],
  carClass: string,
): PitBase | null {
  if (!refuelMeasured(carClass)) return null;
  const bases: number[] = [];
  for (const race of races) {
    for (const stop of race.stops) {
      if (stop.lossS == null || !(stop.addedL != null && stop.addedL > 0))
        continue;
      bases.push(stop.lossS - stop.addedL / REFUEL_L_PER_S);
    }
  }
  if (bases.length < MIN_BASE_STOPS) return null;
  bases.sort((a, b) => a - b);
  return {baseS: Math.max(0, median(bases)), stops: bases.length};
}

/** The model the planner takes; null without a base. */
export function pitModelOf(base: PitBase | null): PitModel | null {
  return base ? {baseS: base.baseS, refuelLPerS: REFUEL_L_PER_S} : null;
}
