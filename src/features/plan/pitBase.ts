import {type PitModel} from '@/src/analysis/fuelPlan';
import {REFUEL_L_PER_S, refuelMeasured} from '@/src/analysis/refuel';
import {type Lap, type SessionType, racePitLaps} from '@/src/data/sessions';

// The pit lane base of a track and car, measured from his own stops there
// (pit-wall thread 36 #1071: time in the lane is a per-track base plus
// litres / 3.4, plus 10-15 s when tyres change; there is no stored base).
// Pure.

/** Fewer measured stops than this is not a base, and the Plan counts no pit time. */
export const MIN_BASE_STOPS = 2;

export type PitBase = {baseS: number; stops: number};

/**
 * The median of (time in the lane - litres added / refuel rate) over the
 * race stops that added fuel and are known to have changed no tyres (a stop
 * from before the tyre block, with `tyres` null, is left out rather than
 * guessed). Null where the refuel rate is not measured for the class, or
 * under MIN_BASE_STOPS stops.
 */
export function pitLaneBase(
  sessions: {sessionType: SessionType; laps: Lap[]}[],
  carClass: string,
): PitBase | null {
  if (!refuelMeasured(carClass)) return null;
  const bases: number[] = [];
  for (const s of sessions) {
    for (const lap of racePitLaps(s.sessionType, s.laps)) {
      const stop = lap.pitStop;
      const litres = stop?.added.fuelL;
      if (!stop || stop.inPitS == null || !(litres != null && litres > 0))
        continue;
      if (stop.tyres == null || stop.tyres.changed) continue;
      bases.push(stop.inPitS - litres / REFUEL_L_PER_S);
    }
  }
  if (bases.length < MIN_BASE_STOPS) return null;
  bases.sort((a, b) => a - b);
  const mid = bases.length >> 1;
  const baseS =
    bases.length % 2 ? bases[mid] : (bases[mid - 1] + bases[mid]) / 2;
  return {baseS: Math.max(0, baseS), stops: bases.length};
}

/** The model the planner takes; null without a base. */
export function pitModelOf(base: PitBase | null): PitModel | null {
  return base ? {baseS: base.baseS, refuelLPerS: REFUEL_L_PER_S} : null;
}
