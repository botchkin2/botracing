// The Session lines for the optimal lap and its gap (decisions/lap/2026-10-04-
// sections-and-compare.md, triage #4/#5): per stint, the best time of every
// sector summed ("Optimal lap"), the median of every sector summed ("Typical
// lap"), and Σ(median − best) between them, with the laps behind it. The gap is
// time lost to inconsistency, and it is only comparable within a session
// (the optimum falls with every lap driven). Neither lap was driven, and
// none is a target (CODE_STANDARDS §7).
import {type StintOptimum} from '@/src/analysis/sectionOptimum';
import {formatLapTime} from '@/src/design';

import type {Fact} from './model';

/** Three facts per stint with enough laps; empty before the sectors or under the floor. */
export function optimumFacts(
  stints: StintOptimum[],
  sectorCount: number,
  stintCount: number,
): Fact[] {
  const facts: Fact[] = [];
  for (const s of stints) {
    if (s.bestSumS == null || s.medianSumS == null) continue;
    const where = stintCount > 1 ? ` · stint ${s.stint}` : '';
    const laps = `${s.lapCount} laps`;
    facts.push(
      {
        label: `Optimal lap${where}`,
        value: `${formatLapTime(s.bestSumS)} · ${laps}, ${sectorCount} sectors`,
      },
      {
        label: `Typical lap${where}`,
        value: `${formatLapTime(s.medianSumS)} · ${laps}`,
      },
      {
        label: `Inconsistency${where}`,
        value: `+${(s.medianSumS - s.bestSumS).toFixed(3)} s · ${laps}`,
      },
    );
  }
  return facts;
}
