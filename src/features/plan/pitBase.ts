import {type PitModel} from '@/src/analysis/fuelPlan';
import {REFUEL_L_PER_S, refuelMeasured} from '@/src/analysis/refuel';
import {type Lap, type SessionType, racePitLaps} from '@/src/data/sessions';

// The pit lane base of a track and car, measured from his own stops there
// (pit-wall thread 36 #1071: a stop is a per-track base plus litres / rate,
// plus 10-15 s when tyres change; there is no stored base; thread 44 #1618).
// What a stop costs the race is the pit LOSS, not the time in the lane: the
// car covers the lane distance anyway, so the loss is the in-lap plus the
// out-lap minus two laps of the stint's median green lap. Pure.

/** Fewer measured stops than this is not a base, and the Plan counts no pit time. */
export const MIN_BASE_STOPS = 2;
/** Green laps a stint needs before its median is a lap to take the loss against. */
const MIN_STINT_LAPS = 3;

export type PitBase = {baseS: number; stops: number};

function median(sorted: number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The median green lap of the stint a lap is in, or null under MIN_STINT_LAPS. */
function stintMedianS(laps: Lap[], stint: number): number | null {
  const times = laps
    .filter(
      l =>
        l.stint === stint &&
        l.comparable &&
        !l.pitIn &&
        !l.pitOut &&
        !l.partial &&
        l.timeS != null,
    )
    .map(l => l.timeS as number)
    .sort((a, b) => a - b);
  return times.length < MIN_STINT_LAPS ? null : median(times);
}

/**
 * The median of (pit loss - litres added / refuel rate) over the race stops
 * that added fuel and are known to have changed no tyres (a stop from before
 * the tyre block, with `tyres` null, is left out rather than guessed). The
 * loss needs the lap after the stop and a stint median to set it against.
 * Null where the refuel rate is not measured for the class, or under
 * MIN_BASE_STOPS stops. The 3.4 L/s rate is `REFUEL_L_PER_S`, measured in
 * thread 34 on 5 stops (src/analysis/refuel.ts).
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
      if (!stop || !(litres != null && litres > 0) || lap.timeS == null)
        continue;
      if (stop.tyres == null || stop.tyres.changed) continue;
      const out = s.laps.find(l => l.lapIndex === lap.lapIndex + 1);
      const typical = stintMedianS(s.laps, lap.stint);
      if (!out || !out.pitOut || out.pitIn || out.timeS == null) continue;
      if (typical == null) continue;
      const lossS = lap.timeS + out.timeS - 2 * typical;
      bases.push(lossS - litres / REFUEL_L_PER_S);
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
