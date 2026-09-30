// "Plan vs what happened" under the race's pit stops (pit-wall thread 42): the
// planner, fed only laps from before this race, against what the race did.
// Numbers and how they were made; no verdict. Pure.
import type {FuelPlan, PlanRules, RaceFacts} from '@/src/analysis/fuelPlan';

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

export type PlanVsRace = {lines: string[]};

const litres = (v: number) => `${v.toFixed(1)} L`;
const pct = (v: number) => `${Math.round(v)} %`;
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
const dateOf = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function changeLine(
  name: string,
  planned: number | null,
  own: number | null,
  fmt: (v: number) => string,
): string | null {
  if (planned == null || own == null || planned <= 0) return null;
  const change = ((own - planned) / planned) * 100;
  return `${name}: ${fmt(planned)} planned, ${fmt(own)} this race (${
    change >= 0 ? '+' : '−'
  }${Math.abs(change).toFixed(0)} %)`;
}

/**
 * The block's lines. `plan` is null when there is nothing to plan from: no
 * fill limit, or no earlier laps at that limit; the block then says so.
 */
export function buildPlanVsRace(
  facts: RaceFacts,
  plan: FuelPlan | null,
  basis: PlanBasis,
): PlanVsRace {
  if (facts.limitL == null)
    return {
      lines: ['No fill limit on record for this race, so there is no plan.'],
    };
  const limit = facts.limitL.toFixed(0);
  if (!plan || basis.laps === 0)
    return {
      lines: [
        `No earlier laps at the ${limit} L limit, so there is no plan for this race.`,
      ],
    };
  const start =
    facts.startL != null && facts.startL < facts.limitL - 0.5
      ? ` Started with ${facts.startL.toFixed(
          0,
        )} L of ${limit} L; the plan assumes a full load.`
      : '';
  const since = basis.since ? `, since ${dateOf(basis.since)}` : '';
  const lines = [
    `Planned from ${plural(basis.laps, 'green lap')} in ${plural(
      basis.sessions,
      'session',
    )} before this race, at the ${limit} L limit${since}, for ${plural(
      facts.raceLaps,
      'lap',
    )}.${start}`,
  ];

  const med = plan.atMedian;
  const p90 = plan.atP90;
  if (med.stops != null) {
    if (med.stops === 0) {
      lines.push(
        'Planned: no stop; one load covers the race at the median use.',
      );
    } else {
      // The planner counts racing laps from 1 after the formation lap; the app
      // numbers laps from the formation lap as L1, so racing lap n is L(n+1).
      const at = (o: typeof med) =>
        o.stopLaps.length ? o.stopLaps.map(n => `L${n + 1}`).join(', ') : null;
      const limited =
        med.firstStint.limitedBy != null
          ? ` (${
              med.firstStint.limitedBy === 've' ? 'VE' : 'fuel'
            } runs out first)`
          : '';
      lines.push(
        `Planned: ${plural(med.stops, 'stop')}. The load reaches ${at(
          med,
        )} at the median use${
          at(p90) ? `, ${at(p90)} at the p90 use` : ''
        }${limited}.`,
      );
    }
  }

  lines.push(
    facts.stops.length === 0
      ? 'Race: no stop.'
      : `Race: ${plural(facts.stops.length, 'stop')}, ${facts.stops
          .map(s => {
            const left = [
              s.vePct != null && `${pct(s.vePct)} VE`,
              s.fuelL != null && `${litres(s.fuelL)} left`,
            ].filter(Boolean);
            return `at L${s.lapIndex}${
              left.length ? ` with ${left.join(' and ')}` : ''
            }`;
          })
          .join('; ')}.`,
  );

  const use = [
    changeLine(
      'Fuel a lap',
      plan.perLap.fuel?.median ?? null,
      facts.ownUse.fuelL,
      v => `${v.toFixed(2)} L`,
    ),
    changeLine(
      'VE a lap',
      plan.perLap.ve?.median ?? null,
      facts.ownUse.vePct,
      v => `${v.toFixed(1)} %`,
    ),
  ].filter((l): l is string => l != null);
  lines.push(...use);
  return {lines};
}

export const PLAN_VS_RACE_HELP: readonly string[] = [
  'The planner was given only laps from before this race, at this race’s fill limit, and this race’s length in laps, the formation lap not counted.',
  'Laps are named as in the lap table: L1 is the formation lap, and the stop is on the lap the pit lane is entered.',
  'The planned stop laps are the last lap the load reaches at that use, not a prediction of when a stop happens.',
  'Fuel and VE a lap are the median over green laps: the history’s, and this race’s own.',
];
