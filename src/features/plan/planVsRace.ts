// What the planner is given for a race (pit-wall threads 42 and 43): its rules,
// and which earlier laps it was made from. The rows themselves are built in
// planHalf.ts. Pure.
import type {PlanRules, RaceFacts} from '@/src/analysis/fuelPlan';

/**
 * How long the race was meant to be: the capture's length when it has one, else
 * the leader's laps (formation not counted), else unknown. The laps this driver
 * completed are never the length: a timed race ends at the flag, a lap after
 * the clock runs out, and a DNF stops short.
 */
export function scheduledLength(
  facts: Pick<RaceFacts, 'race' | 'leaderLapsDone'>,
): NonNullable<RaceFacts['race']> | null {
  if (facts.race) return facts.race;
  const leader = facts.leaderLapsDone;
  return leader != null && leader > 1 ? {kind: 'laps', laps: leader - 1} : null;
}

/**
 * The rules the planner is given for this race: its fill limit, its length
 * (`scheduledLength`), a full VE load and a formation lap. Null without a fill
 * limit or a known length.
 */
export function raceRules(facts: RaceFacts): PlanRules | null {
  const length = scheduledLength(facts);
  if (facts.limitL == null || length == null) return null;
  return {
    name: 'This race',
    lengthLaps: length.kind === 'laps' ? length.laps : null,
    lengthMin: length.kind === 'timed' ? length.minutes : null,
    fuelL: facts.limitL,
    vePct: 100,
    formationLap: true,
    mandatoryStops: 0,
  };
}

/** Which earlier laps the plan was made from. */
export type PlanBasis = {
  laps: number;
  sessions: number;
  /** ISO date of the oldest session used; null when none. */
  since: string | null;
};

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
// By hand: the month names of toLocaleDateString differ between engines.
export const dateOf = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
export const plural = (n: number, word: string) =>
  `${n} ${word}${n === 1 ? '' : 's'}`;
