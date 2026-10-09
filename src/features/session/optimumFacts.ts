// The Session line for the optimal lap (decisions/lap/2026-10-04-sections-and-
// compare.md): the best time of every section summed, per stint, with the laps
// and sections behind it. It is not a lap anyone drove, so it is no target
// (CODE_STANDARDS §7).
import {type StintOptimum} from '@/src/analysis/sectionOptimum';
import {formatLapTime} from '@/src/design';

import type {Fact} from './model';

/** One fact per stint with enough laps; empty before the sections or under the floor. */
export function optimumFacts(
  stints: StintOptimum[],
  sectionCount: number,
  stintCount: number,
): Fact[] {
  const facts: Fact[] = [];
  for (const s of stints) {
    if (s.bestSumS == null) continue;
    const where = stintCount > 1 ? ` · stint ${s.stint}` : '';
    facts.push({
      label: `Optimal lap${where}`,
      value: `${formatLapTime(s.bestSumS)} · ${
        s.lapCount
      } laps, ${sectionCount} sections`,
    });
  }
  return facts;
}
