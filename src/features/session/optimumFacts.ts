// The Session lines for the optimal lap, per stint, over the ticked laps
// (decisions/lap/2026-10-11-selection-and-numbers.md, after 2026-10-04-
// sections-and-compare.md): Optimal is the best time of every segment summed,
// Median the median lap time of the same laps, and Inconsistency the one minus
// the other. Each says how many laps it is "of", and moves with the ticks.
// Optimal was not driven and none is a target (CODE_STANDARDS §7).
import {formatGap, formatLapTime} from '@/src/design';

import type {Fact} from './model';
import type {StintNumbers} from './selectionStats';

/** Three facts per stint with an Optimal; empty before the segments or under the floor. */
export function optimumFacts(
  stints: StintNumbers[],
  stintCount: number,
): Fact[] {
  const facts: Fact[] = [];
  for (const s of stints) {
    const medianS = s.lapTimes.medianS;
    if (s.optimalS == null || medianS == null || s.inconsistencyS == null)
      continue;
    const where = stintCount > 1 ? ` · stint ${s.stint}` : '';
    const of = `of ${s.n}`;
    facts.push(
      {label: `Optimal${where}`, value: `${formatLapTime(s.optimalS)} · ${of}`},
      {label: `Median${where}`, value: `${formatLapTime(medianS)} · ${of}`},
      {
        label: `Inconsistency${where}`,
        value: `${formatGap(s.inconsistencyS)} s · ${of}`,
      },
    );
  }
  return facts;
}
