// The race's pit stops (pit-wall threads 36 and 43): which laps are stops, the
// lap the race ends on, and the wheels a stop changed. Pure. The card itself
// is built in pitCard.ts from these. Numbers, units and what they were
// measured against, never advice (CODE_STANDARDS §7).
import type {Lap, PitTyres, SessionType, Wheel} from '@/src/data/sessions';

// Behind the "?" on the Pit stops card (thread 33 #1119), one sentence a line.
export const PIT_REVIEW_HELP: readonly string[] = [
  'Each stop is a column: what was in the tank at pit entry, what the stop added, VE out and the time in the lane.',
  'Laps are at the median use per green lap of the stint they belong to; the lane bar splits out refuelling only where the rate is measured.',
  'Tyres: the wheels whose wear reading stepped up inside the pit window. Under them, % of a new tyre left per wheel, at pit entry then 1 s after pit exit; a kept wheel is one number. A star is the last valid reading from an earlier lap, for a sensor that reads 0.',
  'The end row is the last whole lap: the tank at the last stop plus what it added, less what was left, is what the laps after it used.',
];

const PAIRS: [string, Wheel[]][] = [
  ['fronts', ['FL', 'FR']],
  ['rears', ['RL', 'RR']],
  ['lefts', ['FL', 'RL']],
  ['rights', ['FR', 'RR']],
];

/**
 * Which tyres were changed, from the wheels the uploader saw step up inside
 * the pit window (thread 38, #1113): "all four", "fronts", "FR only", "FL and
 * RR". Single wheels are real (a flat replaced alone) and not "new tyres".
 */
export function tyresText(tyres: PitTyres): string {
  const w = tyres.wheels;
  if (!tyres.changed || w.length === 0) return 'not changed';
  if (w.length === 4) return 'all four';
  if (w.length === 1) return `${w[0]} only`;
  const pair = PAIRS.find(
    ([, p]) => p.length === w.length && p.every(x => w.includes(x)),
  );
  if (pair) return pair[0];
  return `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
}
