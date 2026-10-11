// The phone Session's line under the lap-time chart: per stint, the Optimal lap
// (best of every segment summed), the Median lap time and the gap between them,
// over the ticked laps and saying how many (selectionStats.ts, decisions/lap/
// 2026-10-11-selection-and-numbers.md). One line each: "Optimal 1:19.976 ·
// Median 1:20.777 · +0.801 s · of 19". Optimal was not driven and none is a
// target (CODE_STANDARDS §7).
import {formatGap, formatLapTime} from '@/src/design';

import type {StintNumbers} from './selectionStats';

export type OptimumLine = {
  /** "Stint 2"; null when the session is one stint. */
  label: string | null;
  optimal: string;
  median: string;
  /** Median minus Optimal, signed: "+0.801 s". */
  inconsistency: string;
  /** "of 19": the ticked laps the numbers are over. */
  of: string;
};

/** One line per stint with an Optimal; none before the segments or under the floor. */
export function optimumLines(
  stints: StintNumbers[],
  stintCount: number,
): OptimumLine[] {
  const lines: OptimumLine[] = [];
  for (const s of stints) {
    const medianS = s.lapTimes.medianS;
    if (s.optimalS == null || medianS == null || s.inconsistencyS == null)
      continue;
    lines.push({
      label: stintCount > 1 ? `Stint ${s.stint}` : null,
      optimal: formatLapTime(s.optimalS),
      median: formatLapTime(medianS),
      inconsistency: `${formatGap(s.inconsistencyS)} s`,
      of: `of ${s.n}`,
    });
  }
  return lines;
}
