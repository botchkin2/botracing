// The Session line for the optimal lap (pit-wall thread 46, #1771 as
// corrected in #1802): per stint, best sections summed and the sum of window
// medians, each with the laps and windows behind it. Neither is a lap anyone
// drove, so neither is called one, and neither is shown as a target
// (CODE_STANDARDS §7).
import {type SessionOptimum} from '@/src/data/sessions';
import {formatLapTime} from '@/src/design';

import type {Fact} from './model';

/** Two facts per stint with enough laps; empty before the windows or under the floor. */
export function optimumFacts(
  optimum: SessionOptimum | null,
  stintCount: number,
): Fact[] {
  if (!optimum) return [];
  const facts: Fact[] = [];
  for (const s of optimum.stints) {
    if (s.bestSumS == null || s.medianSumS == null) continue;
    const where = stintCount > 1 ? ` · stint ${s.stint}` : '';
    const n = `${s.lapCount} laps, ${s.windows.length} windows`;
    facts.push(
      {
        label: `Best sections summed${where}`,
        value: `${formatLapTime(s.bestSumS)} · ${n}`,
      },
      {
        label: `Sum of window medians${where}`,
        value: `${formatLapTime(s.medianSumS)} · ${n}`,
      },
    );
  }
  return facts;
}
