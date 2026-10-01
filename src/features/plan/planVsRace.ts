// What the planner is given for a race (pit-wall threads 42 and 43): its rules,
// and which earlier laps it was made from. The rows themselves are built in
// planHalf.ts. Pure.
import type {PlanRules, RaceFacts} from '@/src/analysis/fuelPlan';

/** The rules the planner is given for this race: its fill limit, a full VE load and a formation lap. */
export function raceRules(facts: RaceFacts): PlanRules | null {
  if (facts.limitL == null) return null;
  return {
    name: 'This race',
    lengthLaps: facts.raceLaps,
    lengthMin: null,
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
