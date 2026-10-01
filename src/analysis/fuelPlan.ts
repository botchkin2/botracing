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
// yellows, weather, safety cars, and what a dropped stop saves (refuelling scales
// with the amount added, so it has no known time gain). The time the plan's stops
// take is counted in a timed race when the caller gives a pit model.
//
// Plain TypeScript with erasable syntax only, no imports: Node can run it.

/** One clean lap of the driver's history at this track and car. */
export interface GreenLap {
  fuelL: number;
  /** Null when the recording had no Virtual Energy channel. */
  vePct: number | null;
  lapTimeS: number;
  sessionId: string;
  /**
   * Whether this lap's own VE use was recorded (its `veUsedPct`), as opposed to
   * `vePct` being fuel over the ratio. Unset counts as not measured.
   */
  veMeasured?: boolean;
  /**
   * The lap's traffic facts (the lap doc's `traffic`), for the clean and
   * traffic medians of the Plan's Per green lap card; null or unset without a field.
   */
  traffic?: {
    trafficAheadS: number;
    passesSufferedAll: number;
    blueFlagS: number;
    battleS: number;
    overtakes: unknown[];
  } | null;
}

/** What the race itself gives the comparison. */
export interface RaceFacts {
  /** A Plan combo key, to find this track+car's earlier sessions. */
  planKey: string;
  startedAt: string;
  /** The event's fill limit; null when the session has none on record. */
  limitL: number | null;
  /** What the car started with, litres; null without the channel. */
  startL: number | null;
  /** Racing laps driven: the formation lap is not counted. */
  raceLaps: number;
  /** Median use per green lap over this race's own laps; null under 3 laps. */
  ownUse: {fuelL: number | null; vePct: number | null};
  /** `lapIndex` is the app's lap number for the pit-in lap, as the pit stops card titles it. */
  stops: {lapIndex: number; fuelL: number | null; vePct: number | null}[];
  /** The tank at the end of the last whole lap; the lap is the app's lap number. */
  end: {lapIndex: number; fuelL: number | null; vePct: number | null} | null;
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
        /** The limits the laps were filtered by; null for a meter that is not the limit. */
        atMost: {fuelL: number | null; vePct: number | null};
        medianLapTimeS: number;
        allMedianLapTimeS: number;
      }
    | {
        n: number;
        atMost: {fuelL: number | null; vePct: number | null};
        lowestFuelL: number | null;
        lowestVePct: number | null;
      };
}

/** What one use-per-lap assumption needs to finish a race in a single load. */
export interface Load {
  /** Litres, and VE % of the full load; null without that meter's history. */
  fuelL: number | null;
  vePct: number | null;
  /** The meter that is closer to its cap (fuel to the max fuel, VE to the start VE). */
  limitedBy: Limit | null;
  /** Whether both fit under the caps the rules give. */
  fits: boolean;
}

/**
 * A race that fits one load, read the other way round (Botkin, thread 35
 * #1015): the load it takes at the median and at the p90 use, and what would be
 * left at the flag if the p90 load were carried and he ran the median.
 */
export interface LoadToFinish {
  /** Race laps this row is for, the formation lap not counted. */
  laps: number;
  atMedian: Load;
  atP90: Load;
  /** Left at the flag on the p90 load when he runs the median; null without a fuel or VE median. */
  leftAtMedian: {
    fuelL: number | null;
    fuelLaps: number | null;
    vePct: number | null;
    veLaps: number | null;
  };
}

/** What a stop costs the race: a pit-loss base per track and car, plus refuelling by the litre. */
export interface PitModel {
  /** Seconds a stop costs the race with nothing added and no tyres: the pit loss, not the time in the lane. */
  baseS: number;
  refuelLPerS: number;
}

/** The time the plan's stops take, taken off a timed race before its laps are counted. */
export interface PitTime {
  stops: number;
  /** Litres a stop adds: what the stint before it used, up to the fill limit. */
  refuelL: number;
  perStopS: number;
  totalS: number;
  /** The lap count without pit time, for the line that shows the difference. */
  lapsWithout: number;
}

export interface FuelPlan {
  history: {laps: number; sessions: number};
  perLap: {
    fuel: Usage | null;
    ve: Usage | null;
    lapTimeS: Usage | null;
  };
  /** Laps in the race: as given, or from minutes at the median lap time. */
  /** `oneMore` is the lap count when the flag falls late; null in a race in laps. */
  raceLaps: {
    estimate: number;
    oneMore: number | null;
    /** A timed race with a pit model and a stop to make; null otherwise. */
    pit: PitTime | null;
  } | null;
  /** Stint and stops at the median use and at the p90 (heavy) use. */
  atMedian: Option;
  atP90: Option;
  /** One fewer stop, from the median use; null when there is none to drop. */
  dropStop: DropStop | null;
  /**
   * Only when the race fits one load at the median use: one row per race-lap
   * count (own estimate, and one more when the flag can fall late).
   */
  loadToFinish: LoadToFinish[] | null;
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

/**
 * The stops a full-tank strategy makes over `raceLaps`: after the first load's
 * laps, then every stint's. `needed` is how many the fuel and VE call for;
 * `stopLaps` are those stops' laps (fewer than `needed` only if a stop would
 * fall at or after the flag). The one place this is worked out: the plan's
 * options and the Plan's pit windows both read it.
 */
export function fullTankStops(
  firstLaps: number,
  stintLaps: number,
  raceLaps: number,
): {needed: number; stopLaps: number[]} {
  const needed =
    raceLaps <= firstLaps ? 0 : Math.ceil((raceLaps - firstLaps) / stintLaps);
  const stopLaps: number[] = [];
  let at = firstLaps;
  while (stopLaps.length < needed && at < raceLaps) {
    stopLaps.push(at);
    at += stintLaps;
  }
  return {needed, stopLaps};
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
  const {needed, stopLaps} = fullTankStops(first.laps, stint.laps, raceLaps);
  const stops = Math.max(needed, rules.mandatoryStops);
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
  // The formation lap is a lap of use taken from the first load, so it is
  // shared out with the race laps: 65 laps + formation on 2 loads is 33 laps
  // of use per load (not 32.5 + 1).
  const burnLaps = Math.ceil(
    (raceLaps + (rules.formationLap ? 1 : 0)) / (targetStops + 1),
  );
  const fuelPerLapL = fuel ? rules.fuelL / burnLaps : null;
  const vePerLapPct = ve ? rules.vePct / burnLaps : null;
  const saveFuelL =
    fuel && fuelPerLapL != null ? fuel.median - fuelPerLapL : null;
  const saveVePct = ve && vePerLapPct != null ? ve.median - vePerLapPct : null;
  // Only a meter that has to use less counts: one that would still reach at
  // today's median is not the limit, and filtering laps by it would prove
  // nothing. (Apex, thread 35 #1003.)
  const needFuel = saveFuelL != null && saveFuelL > 0;
  const needVe = saveVePct != null && saveVePct > 0;
  const atMost = {
    fuelL: needFuel ? fuelPerLapL : null,
    vePct: needVe ? vePerLapPct : null,
  };
  const below = history.filter(
    l =>
      (atMost.fuelL == null || l.fuelL <= atMost.fuelL) &&
      (atMost.vePct == null || (l.vePct != null && l.vePct <= atMost.vePct)),
  );
  const times = history.map(l => l.lapTimeS).sort((a, b) => a - b);
  const compare =
    below.length >= MIN_COMPARE_LAPS && times.length > 0
      ? {
          n: below.length,
          atMost,
          medianLapTimeS: quantile(
            below.map(l => l.lapTimeS).sort((a, b) => a - b),
            0.5,
          ),
          allMedianLapTimeS: quantile(times, 0.5),
        }
      : {
          n: below.length,
          atMost,
          lowestFuelL: needFuel && fuel ? fuel.p10 : null,
          lowestVePct: needVe && ve ? ve.p10 : null,
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

function loadFor(
  rules: PlanRules,
  laps: number,
  fuelPerLap: number | null,
  vePerLap: number | null,
): Load {
  // The formation lap burns a lap of both before the race starts.
  const burn = laps + (rules.formationLap ? 1 : 0);
  const fuelL = fuelPerLap == null ? null : burn * fuelPerLap;
  const vePct = vePerLap == null ? null : burn * vePerLap;
  const fuelShare = fuelL == null ? null : fuelL / rules.fuelL;
  const veShare = vePct == null ? null : vePct / rules.vePct;
  const limitedBy: Limit | null =
    fuelShare != null && veShare != null && fuelShare !== veShare
      ? fuelShare > veShare
        ? 'fuel'
        : 've'
      : null;
  return {
    fuelL,
    vePct,
    limitedBy,
    fits:
      (fuelShare == null || fuelShare <= 1) &&
      (veShare == null || veShare <= 1),
  };
}

function loadToFinishFor(
  rules: PlanRules,
  laps: number,
  fuel: Usage | null,
  ve: Usage | null,
): LoadToFinish {
  const atMedian = loadFor(
    rules,
    laps,
    fuel ? fuel.median : null,
    ve ? ve.median : null,
  );
  const atP90 = loadFor(
    rules,
    laps,
    fuel ? fuel.p90 : null,
    ve ? ve.p90 : null,
  );
  const left = (p90: number | null, median: number | null) =>
    p90 == null || median == null ? null : p90 - median;
  const fuelLeft = left(atP90.fuelL, atMedian.fuelL);
  const veLeft = left(atP90.vePct, atMedian.vePct);
  return {
    laps,
    atMedian,
    atP90,
    leftAtMedian: {
      fuelL: fuelLeft,
      fuelLaps: fuelLeft != null && fuel ? fuelLeft / fuel.median : null,
      vePct: veLeft,
      veLaps: veLeft != null && ve ? veLeft / ve.median : null,
    },
  };
}

function pitTimeFor(
  rules: PlanRules,
  raceLaps: number,
  fuel: Usage | null,
  ve: Usage | null,
  model: PitModel | null,
): PitTime | null {
  if (!model || !fuel) return null;
  const option = optionFor(rules, raceLaps, fuel.median, ve ? ve.median : null);
  const {stops} = option;
  if (stops == null || stops <= 0 || option.stint.laps == null) return null;
  const refuelL = Math.min(rules.fuelL, option.stint.laps * fuel.median);
  const perStopS = model.baseS + refuelL / model.refuelLPerS;
  return {
    stops,
    refuelL,
    perStopS,
    totalS: stops * perStopS,
    lapsWithout: raceLaps,
  };
}

export function planRace(
  rules: PlanRules,
  history: GreenLap[],
  pitModel: PitModel | null = null,
): FuelPlan {
  const fuel = usage(history.map(l => l.fuelL));
  const ve = usage(
    history.filter(l => l.vePct != null).map(l => l.vePct as number),
  );
  const lapTimeS = usage(history.map(l => l.lapTimeS));

  let raceLaps: FuelPlan['raceLaps'] = null;
  if (rules.lengthLaps != null) {
    raceLaps = {estimate: rules.lengthLaps, oneMore: null, pit: null};
  } else if (rules.lengthMin != null && lapTimeS) {
    // The flag falls at the leader's first crossing after the time T is up,
    // somewhere in (T, T + a leader lap], and he takes it at his next crossing:
    // ceil(T / m) laps or one more, never fewer. Where in that span the leader
    // crosses is not knowable (lap spread, their stops), so one more is always
    // possible. Time in the pits comes off the clock when a pit model is
    // given: the stop count is that of the race without it (one pass, not a
    // fixed point; a stop more or less moves the count by a lap at most).
    const clockS = rules.lengthMin * 60;
    const lapsWithout = Math.ceil(clockS / lapTimeS.median);
    const pit = pitTimeFor(rules, lapsWithout, fuel, ve, pitModel);
    const estimate = pit
      ? Math.ceil((clockS - pit.totalS) / lapTimeS.median)
      : lapsWithout;
    raceLaps = {estimate, oneMore: estimate + 1, pit};
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

  const loadToFinish =
    raceLaps != null && atMedian.stops === 0 && (fuel != null || ve != null)
      ? [raceLaps.estimate, raceLaps.oneMore]
          .filter((n): n is number => n != null && n > 0)
          .map(n => loadToFinishFor(rules, n, fuel, ve))
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
    loadToFinish,
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
