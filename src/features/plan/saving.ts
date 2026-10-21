// The Saving card (pit-wall thread 99, row PLN, design #6684 item 4): when the
// plan asks for less use a lap than he runs, three numbers side by side, no
// verdict. The target, how many of his green laps were at or under it, and the
// best median a whole stint of his held here: a single lap can be a tow or a
// yellow, a stint of five or more cannot. Pure.
import {
  type DropStop,
  type GreenLap,
  MIN_COMPARE_LAPS,
} from '@/src/analysis/fuelPlan';
import {median} from '@/src/analysis/setStats';

/** Laps in a row a stint needs before its median counts (gauge #6681 item 4). */
export const MIN_STINT_LAPS = 5;

export type Saving = {
  meter: 've' | 'fuel';
  /** The most a lap may use, % or L. */
  target: number;
  /** His green laps at or under the target, of all of them. */
  atOrUnder: {n: number; of: number};
  /** The lowest median over his stints of MIN_STINT_LAPS green laps or more; null: no full stint yet. */
  bestStint: number | null;
  /** Median lap time of the laps at or under, and of all; null under MIN_COMPARE_LAPS laps. */
  lapTimes: {atOrUnderS: number; allS: number} | null;
};

const useOf = (l: GreenLap, meter: 've' | 'fuel') =>
  meter === 've' ? l.vePct : l.fuelL;

/**
 * The best stint median: a stint is a run of consecutive green laps of one
 * session (its `lapIndex` one after the other), so a stop or a yellow lap ends
 * it. Laps without a place are not grouped.
 */
export function bestStintMedian(
  history: readonly GreenLap[],
  meter: 've' | 'fuel',
): number | null {
  const runs: number[][] = [];
  let run: number[] = [];
  let prev: GreenLap | null = null;
  const ordered = history
    .filter(l => l.lapIndex != null && useOf(l, meter) != null)
    .sort(
      (a, b) =>
        a.sessionId.localeCompare(b.sessionId) ||
        (a.lapIndex as number) - (b.lapIndex as number),
    );
  for (const l of ordered) {
    const next =
      prev != null &&
      prev.sessionId === l.sessionId &&
      (l.lapIndex as number) === (prev.lapIndex as number) + 1;
    if (!next) {
      runs.push(run);
      run = [];
    }
    run.push(useOf(l, meter) as number);
    prev = l;
  }
  runs.push(run);
  let best: number | null = null;
  for (const r of runs) {
    if (r.length < MIN_STINT_LAPS) continue;
    const m = median(r);
    if (m != null && (best == null || m < best)) best = m;
  }
  return best;
}

/**
 * The card's numbers for a use target, or null when the plan asks for no
 * saving. `target` is the most a lap may use: the drop-a-stop target, or what
 * a slider stop past its safe end needs.
 */
export function savingOf(
  meter: 've' | 'fuel',
  target: number | null,
  history: readonly GreenLap[],
): Saving | null {
  if (target == null || !(target > 0)) return null;
  const withUse = history.filter(l => useOf(l, meter) != null);
  if (withUse.length === 0) return null;
  const under = withUse.filter(l => (useOf(l, meter) as number) <= target);
  const timeOf = (laps: GreenLap[]) => median(laps.map(l => l.lapTimeS));
  const underS = under.length >= MIN_COMPARE_LAPS ? timeOf(under) : null;
  const allS = timeOf(withUse);
  return {
    meter,
    target,
    atOrUnder: {n: under.length, of: withUse.length},
    bestStint: bestStintMedian(withUse, meter),
    lapTimes:
      underS != null && allS != null ? {atOrUnderS: underS, allS} : null,
  };
}

/** The drop-a-stop target in the meter shown; null when there is none. */
export function dropTarget(
  drop: DropStop | null,
  meter: 've' | 'fuel',
): number | null {
  if (!drop) return null;
  return meter === 've' ? drop.vePerLapPct : drop.fuelPerLapL;
}
