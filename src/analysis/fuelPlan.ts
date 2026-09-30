// Pre-race fuel and Virtual Energy planner (roadmap E4; pit wall thread 35).
//
// An instrument: it turns the driver's own green laps at a track and car into
// numbers for one set of event rules, and recommends nothing. Every figure
// comes from the history passed in; with too little history a figure is null,
// never a default.
//
// Fuel and VE are two separate meters. VE 100 % is the full load at the fill
// limit, but fuel per lap and VE per lap are not tied to each other, so each
// limit is worked out from its own history and the smaller stint names the
// limiting one.
//
// Not modelled (the screen says so): tyres and double-stinting, full-course
// yellows, weather, safety cars, and the time a stop takes (refuelling scales
// with the amount added, so dropping a stop does not have a known time gain).
//
// Plain TypeScript with erasable syntax only, no imports: Node can run it.

/** One clean lap of the driver's history at this track and car. */
export interface GreenLap {
  fuelL: number;
  /** Null when the recording had no Virtual Energy channel. */
  vePct: number | null;
  lapTimeS: number;
  sessionId: string;
}

export interface PlanRules {
  name: string;
  /** Exactly one of lengthLaps / lengthMin is set. */
  lengthLaps: number | null;
  lengthMin: number | null;
  /** Fuel loaded at the start, litres: the fill limit, else the tank. */
  fuelL: number;
  /** VE at the start, % of the full load (100 unless the event caps it). */
  vePct: number;
  /** LMU runs one formation lap, burning one median lap of fuel and VE. */
  formationLap: boolean;
  mandatoryStops: number;
}

/** Fewer green laps than this and a median is not shown (matches the uploader). */
export const MIN_GREEN_LAPS = 3;
/** Laps at or below the saving needed, before their lap time is quoted. */
export const MIN_COMPARE_LAPS = 5;

export interface Usage {
  median: number;
  p10: number;
  p90: number;
  n: number;
}

export type Limit = 'fuel' | 've';

/** A stint's length under one use-per-lap assumption. */
export interface Stint {
  fuelLaps: number | null;
  veLaps: number | null;
  /** The smaller of the two; null when neither could be worked out. */
  laps: number | null;
  /** Which meter runs out first; null when they agree or nothing is known. */
  limitedBy: Limit | null;
}

/** What the race takes at one use-per-lap assumption ("median" or "p90"). */
export interface Option {
  /** First stint (formation lap taken off), then every later stint. */
  firstStint: Stint;
  stint: Stint;
  stops: number | null;
  /** Lap numbers after which a full-tank strategy stops (fuel stops only). */
  stopLaps: number[];
  /** Mandatory stops beyond the ones the fuel needs: any lap will do. */
  anyLapStops: number;
  /**
   * The same number of stops with stints as equal as the tank allows: the
   * first stint is capped by its capacity (the formation lap is burnt from it),
   * the rest share what is left. Null if a later stint would not fit the
   * tank (a guard: the stop count already rules it out).
   */
  even: {
    firstLaps: number;
    firstFuelL: number | null;
    firstVePct: number | null;
    laps: number;
    fuelL: number | null;
    vePct: number | null;
  } | null;
}

export interface DropStop {
  targetStops: number;
  /** The most one lap may use for the stints to reach with one fewer stop. */
  fuelPerLapL: number | null;
  vePerLapPct: number | null;
  /** Median use minus the above; positive means less than he uses now. */
  saveFuelL: number | null;
  saveVePct: number | null;
  saveFuelPct: number | null;
  saveVePctOfMedian: number | null;
  /** His laps that already used that little, beside all his green laps. */
  compare:
    | {
        n: number;
        medianLapTimeS: number;
        allMedianLapTimeS: number;
      }
    | {n: number; lowestFuelL: number | null; lowestVePct: number | null};
}

export interface FuelPlan {
  history: {laps: number; sessions: number};
  perLap: {
    fuel: Usage | null;
    ve: Usage | null;
    lapTimeS: Usage | null;
  };
  /** Laps in the race: as given, or from minutes at the median lap time. */
  raceLaps: {estimate: number; oneFewer: number | null} | null;
  /** Stint and stops at the median use and at the p90 (heavy) use. */
  atMedian: Option;
  atP90: Option;
  /** One fewer stop, from the median use; null when there is none to drop. */
  dropStop: DropStop | null;
}

function quantile(sorted: number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

export function usage(values: number[]): Usage | null {
  const v = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < MIN_GREEN_LAPS) return null;
  return {
    median: quantile(v, 0.5),
    p10: quantile(v, 0.1),
    p90: quantile(v, 0.9),
    n: v.length,
  };
}

function lapsIn(capacity: number, perLap: number | null): number | null {
  if (perLap == null || perLap <= 0 || capacity <= 0) return null;
  return Math.floor(capacity / perLap);
}

function stintFor(
  fuelCap: number,
  veCap: number,
  fuelPerLap: number | null,
  vePerLap: number | null,
): Stint {
  const fuelLaps = lapsIn(fuelCap, fuelPerLap);
  const veLaps = lapsIn(veCap, vePerLap);
  const known = [fuelLaps, veLaps].filter((x): x is number => x != null);
  if (known.length === 0)
    return {fuelLaps, veLaps, laps: null, limitedBy: null};
  const laps = Math.min(...known);
  const limitedBy: Limit | null =
    fuelLaps != null && veLaps != null && fuelLaps !== veLaps
      ? fuelLaps < veLaps
        ? 'fuel'
        : 've'
      : null;
  return {fuelLaps, veLaps, laps, limitedBy};
}

function none(firstStint: Stint, stint: Stint): Option {
  return {
    firstStint,
    stint,
    stops: null,
    stopLaps: [],
    anyLapStops: 0,
    even: null,
  };
}

function optionFor(
  rules: PlanRules,
  raceLaps: number | null,
  fuelPerLap: number | null,
  vePerLap: number | null,
): Option {
  // The formation lap is burnt from the first load, before lap 1.
  const first = stintFor(
    rules.formationLap && fuelPerLap != null
      ? rules.fuelL - fuelPerLap
      : rules.fuelL,
    rules.formationLap && vePerLap != null
      ? rules.vePct - vePerLap
      : rules.vePct,
    fuelPerLap,
    vePerLap,
  );
  const stint = stintFor(rules.fuelL, rules.vePct, fuelPerLap, vePerLap);
  if (raceLaps == null || first.laps == null || stint.laps == null)
    return none(first, stint);
  // A stint of zero laps would never finish the race.
  if (first.laps <= 0 || stint.laps <= 0) return none(first, stint);
  const needed =
    raceLaps <= first.laps
      ? 0
      : Math.ceil((raceLaps - first.laps) / stint.laps);
  const stops = Math.max(needed, rules.mandatoryStops);
  const stopLaps: number[] = [];
  let at = first.laps;
  while (stopLaps.length < needed && at < raceLaps) {
    stopLaps.push(at);
    at += stint.laps;
  }
  const evenLaps = Math.ceil(raceLaps / (stops + 1));
  const firstLaps = Math.min(evenLaps, first.laps);
  const laps =
    stops > 0 ? Math.ceil((raceLaps - firstLaps) / stops) : firstLaps;
  const formation = rules.formationLap ? 1 : 0;
  return {
    firstStint: first,
    stint,
    stops,
    stopLaps,
    anyLapStops: stops - needed,
    even:
      laps > stint.laps
        ? null
        : {
            firstLaps,
            firstFuelL:
              fuelPerLap == null ? null : (firstLaps + formation) * fuelPerLap,
            firstVePct:
              vePerLap == null ? null : (firstLaps + formation) * vePerLap,
            laps,
            fuelL: fuelPerLap == null ? null : laps * fuelPerLap,
            vePct: vePerLap == null ? null : laps * vePerLap,
          },
  };
}

function dropStopFor(
  rules: PlanRules,
  raceLaps: number,
  stops: number,
  fuel: Usage | null,
  ve: Usage | null,
  history: GreenLap[],
): DropStop | null {
  const targetStops = stops - 1;
  if (targetStops < rules.mandatoryStops || targetStops < 0) return null;
  const stintLaps = Math.ceil(raceLaps / (targetStops + 1));
  // The first stint also carries the formation lap.
  const burnLaps = stintLaps + (rules.formationLap ? 1 : 0);
  const fuelPerLapL = fuel ? rules.fuelL / burnLaps : null;
  const vePerLapPct = ve ? rules.vePct / burnLaps : null;
  const saveFuelL =
    fuel && fuelPerLapL != null ? fuel.median - fuelPerLapL : null;
  const saveVePct = ve && vePerLapPct != null ? ve.median - vePerLapPct : null;
  const below = history.filter(
    l =>
      (fuelPerLapL == null || l.fuelL <= fuelPerLapL) &&
      (vePerLapPct == null || (l.vePct != null && l.vePct <= vePerLapPct)),
  );
  const times = history.map(l => l.lapTimeS).sort((a, b) => a - b);
  const compare =
    below.length >= MIN_COMPARE_LAPS && times.length > 0
      ? {
          n: below.length,
          medianLapTimeS: quantile(
            below.map(l => l.lapTimeS).sort((a, b) => a - b),
            0.5,
          ),
          allMedianLapTimeS: quantile(times, 0.5),
        }
      : {
          n: below.length,
          lowestFuelL: fuel ? fuel.p10 : null,
          lowestVePct: ve ? ve.p10 : null,
        };
  return {
    targetStops,
    fuelPerLapL,
    vePerLapPct,
    saveFuelL,
    saveVePct,
    saveFuelPct:
      fuel && saveFuelL != null ? (saveFuelL / fuel.median) * 100 : null,
    saveVePctOfMedian:
      ve && saveVePct != null ? (saveVePct / ve.median) * 100 : null,
    compare,
  };
}

const NO_OPTION: Option = none(
  {fuelLaps: null, veLaps: null, laps: null, limitedBy: null},
  {fuelLaps: null, veLaps: null, laps: null, limitedBy: null},
);

export function planRace(rules: PlanRules, history: GreenLap[]): FuelPlan {
  const fuel = usage(history.map(l => l.fuelL));
  const ve = usage(
    history.filter(l => l.vePct != null).map(l => l.vePct as number),
  );
  const lapTimeS = usage(history.map(l => l.lapTimeS));

  let raceLaps: FuelPlan['raceLaps'] = null;
  if (rules.lengthLaps != null) {
    raceLaps = {estimate: rules.lengthLaps, oneFewer: null};
  } else if (rules.lengthMin != null && lapTimeS) {
    // The race ends at the first line crossing after the time is up.
    const estimate = Math.ceil((rules.lengthMin * 60) / lapTimeS.median);
    // The flag falls when the overall leader finishes, so a slower class can
    // get one lap fewer.
    raceLaps = {estimate, oneFewer: Math.max(0, estimate - 1)};
  }

  const laps = raceLaps ? raceLaps.estimate : null;
  const atMedian =
    fuel || ve
      ? optionFor(rules, laps, fuel ? fuel.median : null, ve ? ve.median : null)
      : NO_OPTION;
  const atP90 =
    fuel || ve
      ? optionFor(rules, laps, fuel ? fuel.p90 : null, ve ? ve.p90 : null)
      : NO_OPTION;

  const dropStop =
    laps != null && atMedian.stops != null && atMedian.stops > 0
      ? dropStopFor(rules, laps, atMedian.stops, fuel, ve, history)
      : null;

  return {
    history: {
      laps: history.length,
      sessions: new Set(history.map(l => l.sessionId)).size,
    },
    perLap: {fuel, ve, lapTimeS},
    raceLaps,
    atMedian,
    atP90,
    dropStop,
  };
}

/**
 * A preset is "may be stale" when its max fuel is not what he last ran at the
 * track and car (`fillLimitL` from that session's setup). Both numbers come
 * back so the screen can show them; the planner never switches presets itself.
 */
export function presetMismatch(
  presetFuelL: number,
  lastFillLimitL: number | null,
): {presetL: number; lastL: number} | null {
  if (lastFillLimitL == null) return null;
  return Math.abs(presetFuelL - lastFillLimitL) > 0.5
    ? {presetL: presetFuelL, lastL: lastFillLimitL}
    : null;
}
