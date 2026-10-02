// The Plan screen's typed cards (round 5, frames 1 and 8; pit-wall thread 43):
// Race, Per tank and Stops as numbers, before any layout. Pure. The screen
// draws them; the old row text (`planView`) stays until the screen switches.
import {
  fullTankStops,
  type FuelPlan,
  type PlanRules,
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
  /** The use of each stint in the unit shown, finished: "100 · 98 · 60 %" or "67 · 67 · 40 L"; null without that meter. Set by the Stops card. */
  perStintText: string | null;
  /** The refuelling time of each stop, finished: "26.5 s · 25.9 s"; null where the rate is not measured for the class or there is no stop. Set by the Stops card. */
  refuelText: string | null;
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
  /** "1 more stop than at median use", or why there is no window; null when neither applies. */
  windowNote: string | null;
  equal: StopRow | null;
  /** What the formation lap takes from the first stint; null without one. */
  formation: {fuelL: number | null; vePct: number | null} | null;
};

const pct = (v: number) => `${Math.round(v)} %`;

function raceCard(plan: FuelPlan, rules: PlanRules): RaceCard {
  const med = plan.atMedian;
  const race = plan.raceLaps;
  const median = plan.perLap.lapTimeS?.median ?? null;
  let working: string | null = null;
  if (race && rules.lengthMin != null && median != null) {
    const seconds = rules.lengthMin * 60;
    const pit = race.pit;
    const clock = pit
      ? `(${seconds.toLocaleString('en-GB')} s - ${Math.round(
          pit.totalS,
        )} s in the pits)`
      : `${seconds.toLocaleString('en-GB')} s`;
    working = `At the median lap, ${formatLapTime(
      median,
    )}: ${clock} ÷ ${median.toFixed(1)} s = ${(
      (seconds - (pit?.totalS ?? 0)) /
      median
    ).toFixed(1)}, so ${race.estimate} laps.${
      race.oneMore == null
        ? ''
        : ` The flag can fall a lap later than your own pace says: ${race.oneMore} laps.`
    } ${
      pit
        ? `Pit time: ${pit.stops} ${
            pit.stops === 1 ? 'stop' : 'stops'
          } × (${Math.round(
            pit.perStopS - pit.refuelL / REFUEL_L_PER_S,
          )} s loss + ${pit.refuelL.toFixed(
            0,
          )} L ÷ ${REFUEL_L_PER_S} L/s) = ${Math.round(pit.totalS)} s; ${
            pit.lapsWithout
          } laps without it.`
        : 'Time in the pits is not counted.'
    }`;
  }
  return {
    laps: race ? race.estimate : null,
    oneMore: race?.oneMore ?? null,
    stops: med.stops,
    stopAfter: med.stopLaps.map(lapName),
    working,
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
    perStintText: null,
    refuelText: null,
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
  const base = `If the flag falls late, one load does not reach: one stop`;
  const late = (plan.loadToFinish ?? []).find(r => r.laps === safeLaps);
  if (!late) return `${base}.`;
  const burnLaps = safeLaps + (rules.formationLap ? 1 : 0);
  const byVe = late.atP90.limitedBy === 've' || late.atP90.fuelL == null;
  const atMost = byVe
    ? late.atP90.vePct == null
      ? null
      : `${(rules.vePct / burnLaps).toFixed(2)} % a lap`
    : `${(rules.fuelL / burnLaps).toFixed(2)} L a lap`;
  return atMost == null ? `${base}.` : `${base}, or use at most ${atMost}.`;
}

/**
 * The text a stops row prints beside its laps: what each stint uses in the
 * unit shown, and the refuelling time of each stop. Finished here, so the
 * component only draws it.
 */
function describeRow(r: StopRow, unit: Unit, carClass: string): StopRow {
  const shown = effectiveUnit(unit, r.vePerStint.length > 0);
  const values = shown === 've' ? r.vePerStint : r.fuelPerStint;
  const times = r.refuel.map(x => refuelS(x.litres, carClass));
  return {
    ...r,
    perStintText:
      values.length === 0
        ? null
        : `${values.map(v => Math.round(v)).join(' · ')} ${
            shown === 've' ? '%' : 'L'
          }`,
    refuelText:
      times.length === 0 || times.some(t => t == null)
        ? null
        : (times as number[]).map(t => `${t.toFixed(1)} s`).join(' · '),
  };
}

function stopsCard(
  plan: FuelPlan,
  rules: PlanRules,
  fuelOnly: boolean,
  ratioPerPctL: number | null,
  unit: Unit,
  carClass: string,
): StopsCard {
  const med = plan.atMedian;
  const laps = plan.raceLaps?.estimate ?? null;
  const fuelPerLap = plan.perLap.fuel?.median ?? null;
  const vePerLap = plan.perLap.ve?.median ?? null;
  if (laps == null || med.stops == null)
    return {
      full: null,
      equal: null,
      windows: [],
      perStintHeader: 'Use per stint',
      windowNote: null,
      formation: null,
    };
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
  // The window is the safe one: stops planned at p90 use, so each stop is the
  // lap the tank runs out at the heavier 10 % of the laps, both ends of its
  // window use that rate, and the race is the safe length: one lap more than
  // the estimate where the flag can fall late (setup, thread 44 #1598 item 3,
  // #1662 and the #224 review). The median's 'tank runs out' lap is kept beside
  // it as the optimistic case. The stop counts are worked out at that length.
  const safeLaps = plan.raceLaps?.oneMore ?? laps;
  const p90 = plan.atP90;
  const first90 = p90.firstStint.laps;
  const stint90 = p90.stint.laps;
  let windows: StopWindow[] = [];
  let p90StopCount = 0;
  // A plan with no stop shows nothing new here: 'load to finish' covers it (round 7).
  if (
    fuelStops > 0 &&
    first90 != null &&
    stint90 != null &&
    first90 > 0 &&
    stint90 > 0
  ) {
    const stops = fullTankStops(first90, stint90, safeLaps).stopLaps;
    p90StopCount = stops.length;
    windows = pitWindows(first90, stint90, safeLaps, stops.length).map(w => ({
      stop: w.stop,
      earliest: w.earliest,
      latest: w.latest,
      planLap: stops[w.stop - 1] ?? w.latest,
      medianLap: med.stopLaps[w.stop - 1] ?? null,
      text: windowText(w, med.stopLaps[w.stop - 1] ?? null),
    }));
  }
  const medianStopCount =
    med.firstStint.laps != null &&
    med.stint.laps != null &&
    med.firstStint.laps > 0 &&
    med.stint.laps > 0
      ? fullTankStops(med.firstStint.laps, med.stint.laps, safeLaps).stopLaps
          .length
      : fuelStops;
  const extra = p90StopCount - medianStopCount;
  const windowNote =
    fuelStops === 0
      ? lateFlagNote(plan, rules, safeLaps, first90, stint90)
      : p90StopCount > 0 && windows.length === 0
      ? NO_WINDOW_NOTE
      : extra > 0
      ? `${extra} more ${extra === 1 ? 'stop' : 'stops'} than at median use`
      : null;
  const shownUnit = effectiveUnit(unit, !fuelOnly && vePerLap != null);
  return {
    full: full && describeRow(full, unit, carClass),
    equal: equal && describeRow(equal, unit, carClass),
    windows,
    perStintHeader: shownUnit === 've' ? 'VE per stint' : 'Fuel per stint',
    windowNote,
    formation: rules.formationLap
      ? {fuelL: fuelPerLap, vePct: fuelOnly ? null : vePerLap}
      : null,
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
    race: raceCard(plan, rules),
    tank: tankCard(plan, rules, fuelOnly, unit),
    stops: stopsCard(plan, rules, fuelOnly, ratioPerPctL, unit, carClass),
  };
}
