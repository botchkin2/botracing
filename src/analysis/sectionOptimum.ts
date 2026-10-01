// Best and median time per corner window over one stint's laps, and the two
// sums (pit-wall thread 46, #1771 as corrected in #1794 and #1802). Pure:
// the caller decides which window times count and passes null for the rest.
//
// Only off-track, yellow and pit windows are left out (by the caller);
// tow and traffic never remove a time (decisions/lap/2026-10-01-corner-
// windows.md). Stints are kept apart because one stint is one fuel and tyre
// arc: stitching a fresh-tyre corner to a low-fuel straight from the other end
// of a session describes a car that never ran.
//
// "Best sections summed" is a bound, not a lap anyone drove, and it falls as
// laps are added; "sum of window medians" is not a driven lap either, but it
// barely moves with the lap count. Both carry their n.

/** Fewest times a window needs before its best and median are shown. */
export const MIN_OPTIMUM_LAPS = 5;

export interface OptimumLap {
  id: string;
  stint: number;
  /** Seconds in each window, in lap order; null when the window does not count for this lap. */
  windowsS: (number | null)[];
}

export interface WindowOptimum {
  /** Times that counted for this window in the stint. */
  n: number;
  /** Null under MIN_OPTIMUM_LAPS. */
  bestS: number | null;
  bestLapId: string | null;
  medianS: number | null;
}

export interface StintOptimum {
  stint: number;
  /** Laps of the stint that were given. */
  lapCount: number;
  /** One per window, in lap order. */
  windows: WindowOptimum[];
  /** Null unless every window has a best, since a sum with a hole is not a lap. */
  bestSumS: number | null;
  medianSumS: number | null;
}

function median(sorted: number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function windowOptimum(
  laps: OptimumLap[],
  index: number,
): WindowOptimum {
  const times: {id: string; t: number}[] = [];
  for (const lap of laps) {
    const t = lap.windowsS[index];
    if (t != null && Number.isFinite(t)) times.push({id: lap.id, t});
  }
  if (times.length < MIN_OPTIMUM_LAPS)
    return {n: times.length, bestS: null, bestLapId: null, medianS: null};
  let best = times[0];
  for (const x of times) if (x.t < best.t) best = x;
  const sorted = times.map(x => x.t).sort((a, b) => a - b);
  return {
    n: times.length,
    bestS: best.t,
    bestLapId: best.id,
    medianS: median(sorted),
  };
}

/** One result per stint with at least MIN_OPTIMUM_LAPS laps, in stint order. */
export function sectionOptimum(
  laps: OptimumLap[],
  windowCount: number,
): StintOptimum[] {
  const byStint = new Map<number, OptimumLap[]>();
  for (const lap of laps) {
    const list = byStint.get(lap.stint);
    if (list) list.push(lap);
    else byStint.set(lap.stint, [lap]);
  }
  const out: StintOptimum[] = [];
  for (const [stint, stintLaps] of [...byStint].sort((a, b) => a[0] - b[0])) {
    if (stintLaps.length < MIN_OPTIMUM_LAPS) continue;
    const windows: WindowOptimum[] = [];
    for (let i = 0; i < windowCount; i++)
      windows.push(windowOptimum(stintLaps, i));
    const whole = windowCount > 0 && windows.every(w => w.bestS != null);
    let bestSumS = 0;
    let medianSumS = 0;
    if (whole)
      for (const w of windows) {
        bestSumS += w.bestS as number;
        medianSumS += w.medianS as number;
      }
    out.push({
      stint,
      lapCount: stintLaps.length,
      windows,
      bestSumS: whole ? bestSumS : null,
      medianSumS: whole ? medianSumS : null,
    });
  }
  return out;
}
