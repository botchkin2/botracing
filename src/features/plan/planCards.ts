// The Plan screen's typed cards (round 5, frames 1 and 8; pit-wall thread 43):
// Race, Per tank and Stops as numbers, before any layout. Pure. The screen
// draws them; the old row text (`planView`) stays until the screen switches.
import type {FuelPlan, PlanRules} from '@/src/analysis/fuelPlan';
import {formatLapTime} from '@/src/design';

/** The app's lap name for the planner's racing lap n: L1 is the formation lap. */
export const lapName = (racingLap: number) => `L${racingLap + 1}`;

export type RaceCard = {
  /** Laps in the race; null without a length or a median lap time. */
  laps: number | null;
  /** One fewer, when a timed race can end a lap early. */
  oneFewer: number | null;
  /** Stops of the full-tank strategy, mandatory ones included; null without data. */
  stops: number | null;
  /** Where the full-tank strategy stops, in the app's lap names ("L27"). */
  stopAfter: string[];
  /** The arithmetic behind the lap count, for a timed race; null for a length in laps. */
  working: string | null;
};

export type TankMeter = {
  key: 'fuel' | 've';
  /** Laps one full load lasts at the median use, and at the p90 use. */
  lapsMedian: number;
  lapsP90: number | null;
  /** "100 L ÷ 2.38 L/lap": where the median number comes from. */
  formula: string;
  /** The shorter meter; never set with one meter. */
  runsOutFirst: boolean;
};

export type TankCard = {
  /** One meter for a fuel-only plan, two otherwise. */
  meters: TankMeter[];
};

export type StopRow = {
  kind: 'full' | 'equal';
  /** Lap names the stops come after ("L27"); empty for no fuel stop. */
  stopAfter: string[];
  /** Laps in each stint, first to last; the first includes the formation lap's use. */
  stintLaps: number[];
  /** VE used in each stint, % of the full load; empty for a fuel-only plan. */
  vePerStint: number[];
  /**
   * Litres each stop adds, one per stop. A middle stop refills to full, which
   * is what the stint before it used. The last stop adds only enough to
   * finish at the median use, `toFinish`, or it would print the over-fill
   * the backtest found (Road Atlanta 09-24: 41.9 L added for 3 laps).
   */
  refuel: {litres: number; toFinish: boolean}[];
};

export type StopsCard = {
  full: StopRow | null;
  equal: StopRow | null;
};

const pct = (v: number) => `${Math.round(v)} %`;

function raceCard(plan: FuelPlan, rules: PlanRules): RaceCard {
  const med = plan.atMedian;
  const race = plan.raceLaps;
  const median = plan.perLap.lapTimeS?.median ?? null;
  let working: string | null = null;
  if (race && rules.lengthMin != null && median != null) {
    const seconds = rules.lengthMin * 60;
    working = `At the median lap, ${formatLapTime(
      median,
    )}: ${seconds.toLocaleString('en-GB')} s ÷ ${median.toFixed(1)} s = ${(
      seconds / median
    ).toFixed(1)}, so ${
      race.estimate
    } laps. The race ends after the leader's lap, which can make it ${
      race.oneFewer ?? race.estimate - 1
    }.`;
  }
  return {
    laps: race ? race.estimate : null,
    oneFewer: race?.oneFewer ?? null,
    stops: med.stops,
    stopAfter: med.stopLaps.map(lapName),
    working,
  };
}

function tankCard(
  plan: FuelPlan,
  rules: PlanRules,
  fuelOnly: boolean,
): TankCard {
  const {fuel, ve} = plan.perLap;
  const meters: TankMeter[] = [];
  if (fuel)
    meters.push({
      key: 'fuel',
      lapsMedian: rules.fuelL / fuel.median,
      lapsP90: rules.fuelL / fuel.p90,
      formula: `${rules.fuelL} L ÷ ${fuel.median.toFixed(2)} L/lap`,
      runsOutFirst: false,
    });
  if (ve && !fuelOnly)
    meters.push({
      key: 've',
      lapsMedian: rules.vePct / ve.median,
      lapsP90: rules.vePct / ve.p90,
      formula: `${pct(rules.vePct)} ÷ ${ve.median.toFixed(2)} %/lap`,
      runsOutFirst: false,
    });
  // Only with two meters is there a "first".
  if (meters.length === 2) {
    const first = meters[0].lapsMedian <= meters[1].lapsMedian ? 0 : 1;
    meters[first].runsOutFirst = true;
  }
  return {meters};
}

/**
 * One stops row from a stint plan: the laps in each stint and what each one
 * uses. `formation` is the formation lap's use, taken from the first stint.
 */
function stopRow(
  kind: 'full' | 'equal',
  stintLaps: number[],
  stopAfter: string[],
  fuelPerLap: number | null,
  vePerLap: number | null,
  formation: boolean,
  rules: PlanRules,
  fuelOnly: boolean,
  ratioPerPctL: number | null,
): StopRow {
  const extra = (i: number) => (i === 0 && formation ? 1 : 0);
  const fuelOf = (i: number) =>
    fuelPerLap == null
      ? null
      : Math.min(rules.fuelL, (stintLaps[i] + extra(i)) * fuelPerLap);
  return {
    kind,
    stopAfter,
    stintLaps,
    vePerStint:
      vePerLap == null || fuelOnly
        ? []
        : stintLaps.map((_, i) =>
            Math.min(rules.vePct, (stintLaps[i] + extra(i)) * vePerLap),
          ),
    // A stop refills what the stint before it used. The last one adds only
    // what it takes to finish: the larger of the fuel the remaining laps need
    // less what is still in the tank, and, when VE is the limit, the VE they
    // need less what is left, in litres through the ratio; both capped at the
    // refill (camber, #168).
    refuel: stintLaps.slice(0, -1).flatMap((_, i, stops): StopRow['refuel'] => {
      const toFull = fuelOf(i);
      if (toFull == null || fuelPerLap == null) return [];
      if (i !== stops.length - 1) return [{litres: toFull, toFinish: false}];
      const remaining = stintLaps[i + 1];
      const fuelLeft = Math.max(0, rules.fuelL - toFull);
      const fuelNeed = Math.max(0, remaining * fuelPerLap - fuelLeft);
      let veNeedL = 0;
      if (vePerLap != null && !fuelOnly && ratioPerPctL != null) {
        const veUsed = Math.min(
          rules.vePct,
          (stintLaps[i] + extra(i)) * vePerLap,
        );
        const veLeft = Math.max(0, rules.vePct - veUsed);
        veNeedL = Math.max(0, remaining * vePerLap - veLeft) * ratioPerPctL;
      }
      const need = Math.max(fuelNeed, veNeedL);
      return need < toFull
        ? [{litres: need, toFinish: true}]
        : [{litres: toFull, toFinish: false}];
    }),
  };
}

function stopsCard(
  plan: FuelPlan,
  rules: PlanRules,
  fuelOnly: boolean,
  ratioPerPctL: number | null,
): StopsCard {
  const med = plan.atMedian;
  const laps = plan.raceLaps?.estimate ?? null;
  const fuelPerLap = plan.perLap.fuel?.median ?? null;
  const vePerLap = plan.perLap.ve?.median ?? null;
  if (laps == null || med.stops == null) return {full: null, equal: null};
  const fuelStops = med.stopLaps.length;
  // Full tank: each stint runs until the meter that runs out first is empty.
  let full: StopRow | null = null;
  if (med.firstStint.laps != null && med.stint.laps != null) {
    // No fuel stop: the whole race is one stint.
    const stints = [fuelStops === 0 ? laps : med.firstStint.laps];
    for (let i = 1; i < fuelStops; i++) stints.push(med.stint.laps);
    if (fuelStops > 0) stints.push(laps - stints.reduce((a, b) => a + b, 0));
    full = stopRow(
      'full',
      stints,
      med.stopLaps.map(lapName),
      fuelPerLap,
      vePerLap,
      rules.formationLap,
      rules,
      fuelOnly,
      ratioPerPctL,
    );
  }
  // Equal stints: the same number of stops, spread evenly.
  let equal: StopRow | null = null;
  const e = med.even;
  if (e && med.stops > 0) {
    const stints = [e.firstLaps];
    let left = laps - e.firstLaps;
    for (let i = 0; i < med.stops; i++) {
      const n = Math.min(e.laps, left);
      stints.push(n);
      left -= n;
    }
    let at = 0;
    const after = stints.slice(0, -1).map(n => lapName((at += n)));
    equal = stopRow(
      'equal',
      stints,
      after,
      fuelPerLap,
      vePerLap,
      rules.formationLap,
      rules,
      fuelOnly,
      ratioPerPctL,
    );
  }
  return {full, equal};
}

export type PlanCards = {
  race: RaceCard;
  tank: TankCard;
  stops: StopsCard;
};

/** The three cards the round 5 frames lead with, as data. */
export function buildPlanCards(
  plan: FuelPlan,
  rules: PlanRules,
  fuelOnly: boolean,
  /** Litres of fuel one % of VE is worth here; null without VE. */
  ratioPerPctL: number | null = null,
): PlanCards {
  return {
    race: raceCard(plan, rules),
    tank: tankCard(plan, rules, fuelOnly),
    stops: stopsCard(plan, rules, fuelOnly, ratioPerPctL),
  };
}
