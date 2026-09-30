// The race's pit stops (pit-wall threads 36 and 43): which laps are stops, the
// lap the race ends on, and the wheels a stop changed. Pure. The card itself
// is built in pitCard.ts from these. Numbers, units and what they were
// measured against, never advice (CODE_STANDARDS §7).
import type {Lap, PitTyres, SessionType, Wheel} from '@/src/data/sessions';

// Behind the "?" on the Pit stops card (thread 33 #1119), one sentence a line.
export const PIT_REVIEW_HELP: readonly string[] = [
  'Each stop is a column: what was in the tank at pit entry, what the stop added, VE out and the time in the lane.',
  'Laps are at the median use per green lap of the stint they belong to; the lane bar splits out refuelling only where the rate is measured.',
  'Tyres are the wheels whose wear reading stepped up inside the pit window.',
  'The end row is the last whole lap: the tank at the last stop plus what it added, less what was left, is what the laps after it used.',
];

/**
 * The lap the race ends on: the last one that was not cut short and has a
 * fuel level. `Lap.partial` also carries the game's "incomplete" flag, which
 * LMU sets on the untimed last laps of a race (Le Mans 09-21: L21-L23), so
 * the test is the uploader's own "partial" reason, not that flag (#160).
 */
export function endingLap(laps: Lap[]): Lap | null {
  return (
    [...laps]
      .reverse()
      .find(l => !l.reasons.includes('partial') && l.fuel?.endL != null) ?? null
  );
}

/**
 * The stops of a race, in driving order. The service before the start is not
 * a stop and is left out (camber, thread 36 #1117). Practice and qualifying
 * have none.
 */
export function racePitLaps(sessionType: SessionType, laps: Lap[]): Lap[] {
  if (sessionType !== 'R') return [];
  const first = laps.length > 0 ? laps[0].lapIndex : 0;
  // The service before the start is a window on the first lap that the car
  // leaves (an out lap, `pitOut`), before any timed lap. A stop on the first
  // lap is a real one when the lap ends in the pit lane (`pitIn`): Road
  // Atlanta 09-25 changed the FL on L1, 87 s, after a 267 s lap (camber,
  // thread 43 #1279).
  return laps.filter(
    l => l.pitStop !== null && (l.lapIndex !== first || l.pitIn),
  );
}

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
