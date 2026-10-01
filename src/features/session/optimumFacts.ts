// The Session line for the optimal lap (pit-wall thread 46, #1771 as
// corrected in #1802): per stint, best sections summed and the sum of window
// medians, each with the laps and windows behind it. Neither is a lap anyone
// drove, so neither is called one, and neither is shown as a target
// (CODE_STANDARDS §7).
import {MIN_OPTIMUM_LAPS} from '@/src/analysis/sectionOptimum';
import {type SessionOptimum} from '@/src/data/sessions';
import {formatLapTime} from '@/src/design';

import type {Fact} from './model';

export const OPTIMUM_HELP: readonly string[] = [
  `Best sections summed adds each corner window's fastest time among a stint's comparable laps. It falls as laps are added, so it compares within a session, not across sessions.`,
  `Sum of window medians adds each window's median time. Neither sum is a lap that was driven; they are taken from different laps.`,
  `A window leaves out only a lap that crossed the pit lane, went off track or ran under a local yellow in it. Tow, traffic and blue flags never remove a time.`,
  `A stint shows these from ${MIN_OPTIMUM_LAPS} laps, and only when every window has ${MIN_OPTIMUM_LAPS} counted times; n is the laps and windows behind each sum.`,
];

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
