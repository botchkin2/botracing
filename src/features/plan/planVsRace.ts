// What the planner is given for a race (pit-wall threads 42 and 43): its rules,
// and which earlier laps it was made from. The rows themselves are built in
// planHalf.ts. Pure.
import type {PlanRules, RaceFacts} from '@/src/analysis/fuelPlan';

/** A race's length: the minutes the capture recorded, or the laps a race of that length ran (the class leader's, formation not counted). */
export type ScheduledLength = {minutes: number} | {estimatedLaps: number};

/**
 * How long the race was meant to be: the capture's minutes when it has them
 * (every race is timed), else the laps the leader of the driver's class ran,
 * else unknown. The laps this driver completed are never the length: a timed
 * race ends at the flag, a lap after the clock runs out, and a DNF stops short.
 * Nor are the overall leader's: a faster class runs more laps in the same
 * minutes (pit-wall thread 1 #3101). After a DNF the recording stops with the
 * player, mid-lap for the leader, so its laps are a floor: one lap short is
 * the error that runs a car dry, so a DNF without the minutes has no length
 * (rake #3138).
 */
export function scheduledLength(
  facts: Pick<RaceFacts, 'race' | 'classLeaderLapsDone' | 'leftEarly'>,
): ScheduledLength | null {
  if (facts.race) return facts.race;
  if (facts.leftEarly) return null;
  const leader = facts.classLeaderLapsDone;
  return leader != null && leader > 1 ? {estimatedLaps: leader - 1} : null;
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
    lengthLaps: 'estimatedLaps' in length ? length.estimatedLaps : null,
    lengthMin: 'minutes' in length ? length.minutes : null,
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
