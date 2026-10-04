// The Plan screen's typed cards (round 5, frames 1 and 8; pit-wall thread 43):
// Race, Per tank and Stops as numbers, before any layout. Pure. The screen
// draws them; the old row text (`planView`) stays until the screen switches.
import {
  fullTankStops,
  type FuelPlan,
  plannedStints,
  type PlanRules,
  stopRefuels,
} from '@/src/analysis/fuelPlan';
import {REFUEL_L_PER_S, refuelS} from '@/src/analysis/refuel';
import {formatLapTime} from '@/src/design';

import {effectiveUnit, type Unit} from './unit';

import {type PitWindow, pitWindows} from '@/src/analysis/pitWindow';

/** The app's lap name for the planner's racing lap n: L1 is the formation lap. */
export const lapName = (racingLap: number) => `L${racingLap + 1}`;

export type RaceCard = {
  /** Laps in the race; null without a length or a median lap time. */
  laps: number | null;
  /** The count when the flag falls late, in a timed race; null when it cannot differ. */
  oneMore: number | null;
  /** Stops of the full-tank strategy, mandatory ones included; null without data. */
  stops: number | null;
  /** Where the full-tank strategy stops, in the app's lap names ("L27"). */
  stopAfter: string[];
  /** The arithmetic behind the lap count, for a timed race; null for a length in laps. */
  working: string | null;
  /** "At median use: 5 stops.", only when the median tank would make a different number of stops than the plan (p90 use). */
  medianNote: string | null;
  /** The start load the race needs at the p90 use; null without data. */
  startLoad: StartLoad | null;
};

/**
 * What the car starts with, read from the p90 use (Botkin, thread 44 #1985):
 * a race that fits one load reads it to the flag; a race with stops reads it
 * for the first stint, which is what sets the stop plan.
 */
export type StartLoad = {
  /** "79 % VE (54 L)" in VE, "54 L" in fuel. */
  value: string;
  /** What the load covers: "to finish" or "for the first stint". */
  covers: string;
  /** The laps and use behind it: "30 laps + formation at p90 use". */
  basis: string;
  /** The same load for one more lap, only when the race can run a lap longer; null otherwise. */
  plusOne: string | null;
};

export type TankMeter = {
  key: 'fuel' | 've';
  /** Laps one full load lasts at the median use, and at the p90 use. */
  lapsMedian: number;
  lapsP90: number | null;
  /** "100 L ÷ 2.38 L/lap": where the median number comes from. */
  formula: string;
};

export type TankCard = {
  /** The one meter in the unit shown; empty under 3 green laps. */
  meters: TankMeter[];
  /** "Fuel runs out first: 10.5 laps (84 L ÷ 7.61 L/lap)": the other meter, only when it is the shorter. */
  otherFirst: string | null;
};

/** A stint's row of the Stops table. */
export type StintLine = {
  n: number;
  laps: string;
  /** What the stint uses in the unit shown: "94 %" or "67 L"; null without that meter. */
  use: string | null;
  /** The refuelling at the stop that ends the stint: seconds where the rate is measured for the class, else litres; null for the last stint. */
  refuel: string | null;
  /** The lap the stop that ends the stint comes after ("L27"); null for the last stint. */
  stopAfter: string | null;
};

export type StopRow = {
  kind: 'full' | 'equal';
  /** Lap names the stops come after ("L27"); empty for no fuel stop. */
  stopAfter: string[];
  /** Laps in each stint, first to last; the first includes the formation lap's use. */
  stintLaps: number[];
  /** VE used in each stint, % of the full load; empty for a fuel-only plan. */
  vePerStint: number[];
  /** Fuel used in each stint, litres; empty without a fuel median. */
  fuelPerStint: number[];
  /** One line per stint, finished for the table (round 7 follow-up, parc #1870): one number a cell. Set by the Stops card. */
  lines: StintLine[];
  /**
   * Litres each stop adds, one per stop. A middle stop refills to full, which
   * is what the stint before it used. The last stop adds only enough to
   * finish at the median use, `toFinish`, or it would print the over-fill
   * the backtest found (Road Atlanta 09-24: 41.9 L added for 3 laps).
   */
  refuel: {litres: number; toFinish: boolean}[];
};

export type StopWindow = {
  stop: number;
  /** Racing laps, the axis of the Race timeline: the stop comes after these. */
  earliest: number;
  latest: number;
  /**
   * The planned stop: the full tank at p90 use, so it is the window's latest
   * end (or the lap before the last, if that is earlier). The timeline draws it.
   */
  planLap: number;
  /** Where the tank runs out at the median use, the optimistic case; null with no such stop. */
  medianLap: number | null;
  /** "Stop 2: after L45 to L56 · 12 laps · at median use L57, within 28 laps of stop 1". */
  text: string;
};

export type StopsCard = {
  full: StopRow | null;
  /** The pit window of each fuel stop of the full-tank plan; empty with no stop. */
  windows: StopWindow[];
  /** The column head of the use per stint: "VE per stint" or "Fuel per stint". */
  perStintHeader: string;
  /** The head of the refuel column: "Refuel time" where seconds are known for the class, else "Refuel". */
  refuelHeader: string;
  /** Why there is no window, or the late-flag run-dry case; null when neither applies. */
  windowNote: string | null;
  /** The lap the flag can add, as a margin in numbers: what it uses at p90 and what the last stop would add; null with no stop or no late flag. */
  lateFlag: string | null;
  equal: StopRow | null;
  /** What the formation lap takes from the first stint; null without one. */
  formation: {fuelL: number | null; vePct: number | null} | null;
  /** The formation lap's use in the unit shown ("2 %", "2.4 L"), for its row of the table; null without a formation lap or that meter. */
  formationUse: string | null;
};

const pct = (v: number) => `${Math.round(v)} %`;

function raceCard(
  plan: FuelPlan,
  rules: PlanRules,
  unit: Unit,
  fuelOnly: boolean,
): RaceCard {
  const med = plan.atMedian;
  const planned = plan.atP90;
  const race = plan.raceLaps;
  const median = plan.perLap.lapTimeS?.median ?? null;
  let working: string | null = null;
  if (race && rules.lengthMin != null && median != null) {
    const pit = race.pit;
    working = [
      `${race.estimate} laps`,
      race.oneMore == null ? null : `late flag ${race.oneMore}`,
      `median ${formatLapTime(median)}`,
      pit
        ? `pit ${Math.round(pit.totalS)} s (${pit.stops} × ${Math.round(
            pit.baseS,
          )} s + ${pit.refuelL.toFixed(0)} L at ${REFUEL_L_PER_S} L/s)`
        : null,
      race.settled ? null : 'longest pit time used',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  return {
    laps: race ? race.estimate : null,
    oneMore: race?.oneMore ?? null,
    // One plan (thread 44 #1877): the p90 stops, the ones the Stops card, the
    // windows and the Pit plan show. The median's count is a fact beside them.
    stops: planned.stops,
    stopAfter: planned.stopLaps.map(lapName),
    working,
    medianNote:
      med.stops != null && planned.stops != null && med.stops !== planned.stops
        ? `At median use: ${med.stops} ${med.stops === 1 ? 'stop' : 'stops'}.`
        : null,
    startLoad: startLoadOf(plan, rules, unit, fuelOnly),
  };
}

/**
 * A load in the unit shown, VE first with the litres beside it. LMU loads fuel
 * on the event's static scale with the VE you set (87 % of a 100 L event is
 * 87.0 L, whatever the car burns), so the litres of a VE load are its share of
 * the event's full load, not the fuel burned (parc #2017).
 */
function loadText(
  fuelL: number | null,
  vePct: number | null,
  shown: Unit,
  fullLoadL: number,
): string | null {
  if (shown === 'fuel') return fuelL == null ? null : `${Math.round(fuelL)} L`;
  if (vePct == null) return null;
  return `${Math.round(vePct)} % VE (${Math.round(
    (vePct * fullLoadL) / 100,
  )} L)`;
}

function startLoadOf(
  plan: FuelPlan,
  rules: PlanRules,
  unit: Unit,
  fuelOnly: boolean,
): StartLoad | null {
  const {fuel, ve} = plan.perLap;
  const shown = effectiveUnit(unit, ve != null && !fuelOnly);
  const formation = rules.formationLap ? ' + formation' : '';
  const rows = plan.loadToFinish;
  if (rows && rows.length > 0) {
    const own = rows[0];
    const value = loadText(
      own.atP90.fuelL,
      own.atP90.vePct,
      shown,
      rules.fuelL,
    );
    if (value == null) return null;
    const more = rows[1]
      ? loadText(rows[1].atP90.fuelL, rows[1].atP90.vePct, shown, rules.fuelL)
      : null;
    return {
      value,
      covers: 'to finish',
      basis: `${own.laps} laps${formation} at p90 use`,
      plusOne: more == null ? null : `+1 lap = ${more}`,
    };
  }
  // A race with stops: the first stint sets the stop plan.
  const first = plan.atP90.firstStint.laps;
  if (first == null || plan.atP90.stops == null || plan.atP90.stops < 1)
    return null;
  const burn = first + (rules.formationLap ? 1 : 0);
  const fuelL = fuel ? Math.min(rules.fuelL, burn * fuel.p90) : null;
  const vePct = ve && !fuelOnly ? Math.min(rules.vePct, burn * ve.p90) : null;
  const value = loadText(fuelL, vePct, shown, rules.fuelL);
  if (value == null) return null;
  return {
    value,
    covers: 'for the first stint',
    basis: `${first} laps${formation} at p90 use`,
    plusOne: null,
  };
}

function tankCard(
  plan: FuelPlan,
  rules: PlanRules,
  fuelOnly: boolean,
  unit: Unit,
): TankCard {
  const {fuel, ve} = plan.perLap;
  const meters: TankMeter[] = [];
  if (fuel)
    meters.push({
      key: 'fuel',
      lapsMedian: rules.fuelL / fuel.median,
      lapsP90: rules.fuelL / fuel.p90,
      formula: `${rules.fuelL} L ÷ ${fuel.median.toFixed(2)} L/lap`,
    });
  if (ve && !fuelOnly)
    meters.push({
      key: 've',
      lapsMedian: rules.vePct / ve.median,
      lapsP90: rules.vePct / ve.p90,
      formula: `${pct(rules.vePct)} ÷ ${ve.median.toFixed(2)} %/lap`,
    });
  // One unit at a time (thread 44 #1826); the other meter is named only when
  // it would run out first, as a fact under the bar.
  const shown = effectiveUnit(
    unit,
    meters.some(m => m.key === 've'),
  );
  const mine = meters.find(m => m.key === shown);
  const other = meters.find(m => m.key !== shown);
  const otherFirst =
    mine && other && other.lapsMedian < mine.lapsMedian
      ? `${
          other.key === 've' ? 'VE' : 'Fuel'
        } runs out first: ${other.lapsMedian.toFixed(1)} laps (${
          other.formula
        }).`
      : null;
  return {meters: mine ? [mine] : [], otherFirst};
}

/**
 * One stops row from a stint plan: the laps in each stint and what each one
 * uses. `formation` is the formation lap's use, taken from the first stint.
 */
export function stopRow(
  kind: 'full' | 'equal',
  stintLaps: number[],
  stopAfter: string[],
  fuelPerLap: number | null,
  vePerLap: number | null,
  formation: boolean,
  rules: PlanRules,
  fuelOnly: boolean,
  ratioPerPctL: number | null,
  /**
   * The heavy use (p90) the last stop is sized at, so the final stint reaches
   * the flag in the heavier 10 % of the laps too (parc #1883); the median use
   * when absent. What each stint uses, and what a middle stop refills, stay at
   * the median.
   */
  heavy: {fuelPerLap: number | null; vePerLap: number | null} | null = null,
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
    fuelPerStint:
      fuelPerLap == null ? [] : stintLaps.map((_, i) => fuelOf(i) as number),
    lines: [],
    vePerStint:
      vePerLap == null || fuelOnly
        ? []
        : stintLaps.map((_, i) =>
            Math.min(rules.vePct, (stintLaps[i] + extra(i)) * vePerLap),
          ),
    // The rule is `stopRefuels` (analysis/fuelPlan.ts), which the pit time of a
    // timed race reads too.
    refuel: stopRefuels(
      rules,
      stintLaps,
      {fuel: fuelPerLap, ve: vePerLap},
      heavy && {fuel: heavy.fuelPerLap, ve: heavy.vePerLap},
      ratioPerPctL,
      !fuelOnly,
    ),
  };
}

/** Why a plan with stops has no window: no lap is safe for every stop at p90 use. */
export const NO_WINDOW_NOTE =
  'No pit window: at p90 use no lap is safe for every stop.';

function windowText(w: PitWindow, medianLap: number | null): string {
  const laps = w.latest - w.earliest + 1;
  const median =
    medianLap == null ? '' : ` · at median use ${lapName(medianLap)}`;
  const within =
    w.withinLaps == null
      ? ''
      : `, within ${w.withinLaps} laps of stop ${w.stop - 1}`;
  return `Stop ${w.stop}: after ${lapName(w.earliest)} to ${lapName(
    w.latest,
  )} · ${laps} ${laps === 1 ? 'lap' : 'laps'}${median}${within}`;
}

/**
 * A plan with no stop has no window, but a timed race can run a lap long: when
 * one load at p90 use reaches the estimate and not the late-flag length, that is
 * the run-dry case, so the card says so (setup, thread 44 #1694). The rules cap
 * the load, so the alternatives are one stop, or using at most the capped load
 * over the late-flag laps a lap (the drop-a-stop arithmetic: the formation lap
 * shares the load), in the meter that limits.
 */
function lateFlagNote(
  plan: FuelPlan,
  rules: PlanRules,
  safeLaps: number,
  first90: number | null,
  stint90: number | null,
): string | null {
  if (first90 == null || stint90 == null || first90 <= 0 || stint90 <= 0)
    return null;
  if (fullTankStops(first90, stint90, safeLaps).needed === 0) return null;
  const base = 'Late flag: one stop';
  const late = (plan.loadToFinish ?? []).find(r => r.laps === safeLaps);
  if (!late) return `${base}.`;
  const burnLaps = safeLaps + (rules.formationLap ? 1 : 0);
  const byVe = late.atP90.limitedBy === 've' || late.atP90.fuelL == null;
  const atMost = byVe
    ? late.atP90.vePct == null
      ? null
      : `${(rules.vePct / burnLaps).toFixed(2)} % a lap`
    : `${(rules.fuelL / burnLaps).toFixed(2)} L a lap`;
  return atMost == null ? `${base}.` : `${base}, or at most ${atMost}.`;
}

/** Whether the refuelling time is known for the class: seconds, else litres. */
const refuelInSeconds = (carClass: string) => refuelS(1, carClass) != null;

/**
 * The lines a stops row prints, one per stint, one number a cell: the laps,
 * what the stint uses in the unit shown, and the stop that ends it with what
 * it refuels. Finished here, so the component only draws them.
 */
function describeRow(
  r: StopRow,
  unit: Unit,
  carClass: string,
  /** What the formation lap burns, taken from stint 1's use: it has its own row. */
  formation: {fuelL: number | null; vePct: number | null} | null,
): StopRow {
  const shown = effectiveUnit(unit, r.vePerStint.length > 0);
  const values = [...(shown === 've' ? r.vePerStint : r.fuelPerStint)];
  const formationUse = shown === 've' ? formation?.vePct : formation?.fuelL;
  if (values.length > 0 && formationUse != null)
    values[0] = Math.max(0, values[0] - formationUse);
  const lines = r.stintLaps.map((laps, i): StintLine => {
    const refuel = r.refuel[i];
    const seconds = refuel ? refuelS(refuel.litres, carClass) : null;
    return {
      n: i + 1,
      laps: String(laps),
      use:
        values[i] == null
          ? null
          : `${Math.round(values[i])} ${shown === 've' ? '%' : 'L'}`,
      refuel: !refuel
        ? null
        : seconds != null
        ? `${seconds.toFixed(1)} s`
        : `${refuel.litres.toFixed(1)} L`,
      stopAfter: r.stopAfter[i] ?? null,
    };
  });
  return {...r, lines};
}

/**
 * The late flag as a margin (apex #1871 item 1): the plan runs its own lap
 * count, and the lap the flag can add is not planned as a stop. Says what that
 * lap uses at the p90 and, where the VE to litres ratio is known, what the last
 * stop would add to cover it.
 */
function lateFlagMargin(
  plan: FuelPlan,
  stops: number,
  unit: Unit,
  ratioPerPctL: number | null,
): string | null {
  const oneMore = plan.raceLaps?.oneMore;
  const use = unit === 've' ? plan.perLap.ve?.p90 : plan.perLap.fuel?.p90;
  if (oneMore == null || use == null || stops === 0) return null;
  const litres =
    unit === 've' ? (ratioPerPctL == null ? null : use * ratioPerPctL) : use;
  return `Late flag ${oneMore} laps · +1 lap ${use.toFixed(1)} ${
    unit === 've' ? '% VE' : 'L'
  } at p90${
    litres == null ? '' : ` · +${litres.toFixed(1)} L at the last stop`
  }`;
}

function stopsCard(
  plan: FuelPlan,
  rules: PlanRules,
  fuelOnly: boolean,
  ratioPerPctL: number | null,
  unit: Unit,
  carClass: string,
): StopsCard {
  // One plan (thread 44 #1877): the stops are full tanks at the p90 use, at the
  // plan's own lap count. The median's stops stay as a fact on the Race card
  // and as the tick on each window.
  const med = plan.atMedian;
  const planned = plan.atP90;
  const laps = plan.raceLaps?.estimate ?? null;
  const fuelPerLap = plan.perLap.fuel?.median ?? null;
  const vePerLap = plan.perLap.ve?.median ?? null;
  // The last stop is sized at the p90 use, like the stops (parc #1883).
  const heavy = {
    fuelPerLap: plan.perLap.fuel?.p90 ?? null,
    vePerLap: plan.perLap.ve?.p90 ?? null,
  };
  if (laps == null || planned.stops == null)
    return {
      full: null,
      equal: null,
      windows: [],
      perStintHeader: 'Use per stint',
      refuelHeader: 'Refuel',
      windowNote: null,
      lateFlag: null,
      formation: null,
      formationUse: null,
    };
  const fuelStops = planned.stopLaps.length;
  // Full tank: each stint runs until the meter that runs out first is empty.
  let full: StopRow | null = null;
  if (planned.firstStint.laps != null && planned.stint.laps != null) {
    // No fuel stop: the whole race is one stint.
    const stints = plannedStints(planned, laps);
    full = stopRow(
      'full',
      stints,
      planned.stopLaps.map(lapName),
      fuelPerLap,
      vePerLap,
      rules.formationLap,
      rules,
      fuelOnly,
      ratioPerPctL,
      heavy,
    );
  }
  // Equal stints: the same number of stops, spread evenly.
  let equal: StopRow | null = null;
  const e = planned.even;
  if (e && planned.stops > 0) {
    const stints = [e.firstLaps];
    let left = laps - e.firstLaps;
    for (let i = 0; i < planned.stops; i++) {
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
      heavy,
    );
  }
  // The window is the safe one: stops planned at p90 use, so each stop is the
  // lap the tank runs out at the heavier 10 % of the laps, both ends of its
  // window use that rate. The race is the plan's own length; the lap the flag
  // can add is a margin line (`lateFlagMargin`), not a stop (apex #1871). The
  // median's 'tank runs out' lap is kept beside it as the optimistic case.
  const safeLaps = plan.raceLaps?.oneMore ?? laps;
  const p90 = planned;
  const first90 = p90.firstStint.laps;
  const stint90 = p90.stint.laps;
  let windows: StopWindow[] = [];
  // A plan with no stop shows nothing new here: 'load to finish' covers it (round 7).
  if (
    fuelStops > 0 &&
    first90 != null &&
    stint90 != null &&
    first90 > 0 &&
    stint90 > 0
  ) {
    const stops = p90.stopLaps;
    windows = pitWindows(first90, stint90, laps, stops.length).map(w => ({
      stop: w.stop,
      earliest: w.earliest,
      latest: w.latest,
      planLap: stops[w.stop - 1] ?? w.latest,
      medianLap: med.stopLaps[w.stop - 1] ?? null,
      text: windowText(w, med.stopLaps[w.stop - 1] ?? null),
    }));
  }
  const windowNote =
    fuelStops === 0
      ? lateFlagNote(plan, rules, safeLaps, first90, stint90)
      : fuelStops > 0 && windows.length === 0
      ? NO_WINDOW_NOTE
      : null;
  const shownUnit = effectiveUnit(unit, !fuelOnly && vePerLap != null);
  const formation = rules.formationLap
    ? {fuelL: fuelPerLap, vePct: fuelOnly ? null : vePerLap}
    : null;
  return {
    full: full && describeRow(full, unit, carClass, formation),
    equal: equal && describeRow(equal, unit, carClass, formation),
    windows,
    perStintHeader: shownUnit === 've' ? 'VE per stint' : 'Fuel per stint',
    refuelHeader: refuelInSeconds(carClass) ? 'Refuel time' : 'Refuel',
    windowNote,
    lateFlag: lateFlagMargin(plan, fuelStops, shownUnit, ratioPerPctL),
    formation,
    formationUse:
      formation == null
        ? null
        : shownUnit === 've'
        ? formation.vePct == null
          ? null
          : `${formation.vePct.toFixed(1)} %`
        : formation.fuelL == null
        ? null
        : `${formation.fuelL.toFixed(1)} L`,
  };
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
  /** VE where the plan has it, unless fuel is asked for. */
  unit: Unit = 've',
  /** The car class of the sessions, for the refuel rate; '' where unknown. */
  carClass = '',
): PlanCards {
  return {
    race: raceCard(plan, rules, unit, fuelOnly),
    tank: tankCard(plan, rules, fuelOnly, unit),
    stops: stopsCard(plan, rules, fuelOnly, ratioPerPctL, unit, carClass),
  };
}
