// The race's pit stops (pit-wall threads 36 and 43): which laps are stops, the
// lap the race ends on, and the wheels a stop changed. Pure. The card itself
// is built in pitCard.ts from these. Numbers, units and what they were
// measured against, never advice (CODE_STANDARDS §7).
import type {PitTyres, Wheel} from '@/src/data/sessions';

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
