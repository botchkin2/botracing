import {
  type FuelPlan,
  type PitModel,
  formationLaps,
  type PlanRules,
  startLoad,
} from '@/src/analysis/fuelPlan';

import {lapName, stopRow, type StopWindow} from './planCards';

// The pit-lap slider's model (pit-wall thread 44 #1812/#1819): the stops of the
// plan, each movable over its window, and everything that follows from where
// they are: stint lengths, what each stint uses, what each stop adds and costs,
// the finish. Pure. The default is the planned stops (the windows' plan laps),
// so nothing changes until a stop is moved. Laps are racing laps a stop comes
// after, as in `StopWindow`.

export type PitPlanInput = {
  plan: FuelPlan;
  rules: PlanRules;
  fuelOnly: boolean;
  /** Litres one % of VE is worth; null without VE. */
  ratioPerPctL: number | null;
  /** The Plan's own pit-loss source; null counts no pit time. */
  pitModel: PitModel | null;
  /** One window per stop of the p90 plan; the plan laps are the default. */
  windows: StopWindow[];
};

export type SliderStop = {
  stop: number;
  /** The racing lap the stop comes after, as clamped. */
  after: number;
  /** The slider's bounds: the window's earliest end, and the lap the tank runs out at the median use. */
  min: number;
  max: number;
  /** The last lap that is safe at p90 use, given the stops before it. Past it, the stint runs dry at p90 only. */
  p90Max: number;
  /** Litres added at the stop; null without a fuel history. */
  refuel: {litres: number; toFinish: boolean} | null;
  /** Seconds the stop costs the race (pit loss plus refuelling); null without a pit model or refuel. */
  pitS: number | null;
};

export type PitStint = {
  n: number;
  laps: number;
  /** Laps on the tyres: if they are changed at the stop that starts the stint, and if never changed. */
  tyreLaps: {onSet: number; sinceStart: number};
  /** Used in the stint, formation lap included in the first; null without that meter's history. */
  fuelL: {median: number; p90: number} | null;
  vePct: {median: number; p90: number} | null;
  /** What is left at the end of the stint at the median use, from a full load; 0 when it ran dry. */
  left: {fuelL: number | null; vePct: number | null};
  /** The tank is empty before the stint ends, at the median and at the p90 use. */
  dryAtMedian: boolean;
  dryAtP90: boolean;
};

export type PitPlan = {
  stops: SliderStop[];
  stints: PitStint[];
  /** Racing laps in the race with these stops. */
  finishLaps: number;
  /** Laps more (+) or fewer (-) than the Race card's count; 0 at the planned stops. */
  finishDelta: number;
  /** Seconds the stops cost, and how far that is from the planned stops'; null without a pit model. */
  pit: {totalS: number; deltaS: number} | null;
  /** Any stop away from its plan lap. */
  moved: boolean;
};

const EPS = 1e-9;

type Bounds = {min: number; max: number; p90Max: number};

/** The bounds of stop `k` (1-based) of `n`, with the stop before it at `prev`. */
function boundsOf(
  input: PitPlanInput,
  k: number,
  n: number,
  prev: number,
): Bounds | null {
  const {plan, windows} = input;
  const first50 = plan.atMedian.firstStint.laps;
  const stint50 = plan.atMedian.stint.laps;
  const first90 = plan.atP90.firstStint.laps;
  const stint90 = plan.atP90.stint.laps;
  if (first50 == null || stint50 == null || first90 == null || stint90 == null)
    return null;
  // The plan's own lap count (thread 44 #1877): the late-flag lap is a margin, not a stop.
  const safeLaps = plan.raceLaps?.estimate ?? null;
  if (safeLaps == null) return null;
  // A stop after the flag is no stop, and each stop after this one needs a lap.
  const lastLap = safeLaps - 1 - (n - k);
  const reach = (stint: number, first: number) =>
    Math.floor(prev + (k === 1 ? first : stint));
  const max = Math.min(reach(stint50, first50), lastLap);
  const p90Max = Math.min(reach(stint90, first90), lastLap, max);
  const min = Math.min(Math.max(windows[k - 1].earliest, prev + 1), max);
  return {min, max, p90Max};
}

/** `chosen` clamped stop by stop: moving one stop moves the bounds of those after it. */
function clampStops(
  input: PitPlanInput,
  chosen: readonly number[],
): {after: number; bounds: Bounds}[] {
  const n = input.windows.length;
  const out: {after: number; bounds: Bounds}[] = [];
  let prev = 0;
  for (let k = 1; k <= n; k++) {
    const bounds = boundsOf(input, k, n, prev);
    if (!bounds) return [];
    const want = chosen[k - 1] ?? input.windows[k - 1].planLap;
    const after = Math.min(Math.max(want, bounds.min), bounds.max);
    out.push({after, bounds});
    prev = after;
  }
  return out;
}

/** The planned stops: the windows' plan laps. */
export function plannedStops(windows: StopWindow[]): number[] {
  return windows.map(w => w.planLap);
}

type Worked = {
  stints: number[];
  row: ReturnType<typeof stopRow>;
  pitS: (number | null)[];
  totalS: number | null;
};

function work(
  input: PitPlanInput,
  after: number[],
  finishLaps: number,
): Worked {
  const {plan, rules, fuelOnly, ratioPerPctL, pitModel} = input;
  const stints: number[] = [];
  let at = 0;
  for (const s of after) {
    stints.push(s - at);
    at = s;
  }
  stints.push(Math.max(1, finishLaps - at));
  const row = stopRow(
    'full',
    stints,
    after.map(lapName),
    plan.perLap.fuel?.median ?? null,
    plan.perLap.ve?.median ?? null,
    rules,
    fuelOnly,
    ratioPerPctL,
    {
      fuelPerLap: plan.perLap.fuel?.p90 ?? null,
      vePerLap: plan.perLap.ve?.p90 ?? null,
    },
  );
  const pitS = row.refuel.map(r =>
    pitModel ? pitModel.baseS + r.litres / pitModel.refuelLPerS : null,
  );
  const totalS =
    pitModel && pitS.length > 0 && pitS.every(s => s != null)
      ? (pitS as number[]).reduce((a, b) => a + b, 0)
      : null;
  return {stints, row, pitS, totalS};
}

/**
 * The plan with the stops at `chosen` (the planned stops when null), each
 * clamped to its bounds. The finish moves with the pit time in a timed race:
 * the difference to the planned stops' pit time is added to the Race card's
 * own, so the planned stops give the Race card's count exactly (one pass, like
 * the Race card).
 */
export function pitPlan(
  input: PitPlanInput,
  chosen: readonly number[] | null = null,
): PitPlan | null {
  const {plan, rules, windows} = input;
  const estimate = plan.raceLaps?.estimate;
  if (estimate == null || windows.length === 0) return null;
  const planned = plannedStops(windows);
  const clamped = clampStops(input, chosen ?? planned);
  if (clamped.length !== windows.length) return null;
  const after = clamped.map(c => c.after);

  const base = work(input, planned, estimate);
  const medianLap = plan.perLap.lapTimeS?.median ?? null;
  // The finish moves with the pit time in a timed race, so it is worked out
  // from the stops, one pass like the Race card.
  const finishFor = (stops: number[]): number => {
    const w = work(input, stops, estimate);
    if (
      rules.lengthMin == null ||
      medianLap == null ||
      w.totalS == null ||
      base.totalS == null
    )
      return estimate;
    const deltaS = w.totalS - base.totalS;
    if (deltaS === 0) return estimate;
    const planPitS = plan.raceLaps?.pit?.totalS ?? base.totalS;
    const laps = Math.ceil(
      (rules.lengthMin * 60 - (planPitS + deltaS)) / medianLap - EPS,
    );
    // The last stop must come before the flag.
    return Math.max(laps, stops[stops.length - 1] + 1);
  };
  let finishLaps = finishFor(after);
  // The stint after the last stop starts on a full load: if the finish moved
  // it past a median tank, the last stop is held to the lap that keeps it
  // inside one, so the slider never shows a stint that is empty at the median.
  const reach = Math.floor(plan.atMedian.stint.laps ?? 0);
  const last = after.length - 1;
  for (let i = 0; i < 3; i++) {
    const need = finishLaps - reach;
    if (after[last] >= need || need > clamped[last].bounds.max) break;
    after[last] = need;
    finishLaps = finishFor(after);
  }
  const worked = work(input, after, finishLaps);
  clamped[last].bounds.min = Math.min(
    Math.max(clamped[last].bounds.min, finishLaps - reach),
    clamped[last].bounds.max,
  );

  const fuel = plan.perLap.fuel;
  const ve = rules.vePct > 0 && !input.fuelOnly ? plan.perLap.ve : null;
  let sinceStart = 0;
  const stints: PitStint[] = worked.stints.map((laps, i) => {
    sinceStart += laps;
    // The formation lap is burnt from the first load.
    const formation = formationLaps(rules);
    const burnFuel = laps + (i === 0 ? formation.fuel : 0);
    const burnVe = laps + (i === 0 ? formation.ve : 0);
    const fuelL = fuel
      ? {median: burnFuel * fuel.median, p90: burnFuel * fuel.p90}
      : null;
    const vePct = ve
      ? {median: burnVe * ve.median, p90: burnVe * ve.p90}
      : null;
    // The first stint is tested against what the car starts with (parc #1902),
    // every later one against a full load.
    const loaded = i === 0 ? startLoad(rules) : rules;
    const dry = (pick: 'median' | 'p90') =>
      (fuelL != null && fuelL[pick] > loaded.fuelL + EPS) ||
      (vePct != null && vePct[pick] > loaded.vePct + EPS);
    return {
      n: i + 1,
      laps,
      tyreLaps: {onSet: laps, sinceStart},
      fuelL,
      vePct,
      left: {
        fuelL: fuelL ? Math.max(0, loaded.fuelL - fuelL.median) : null,
        vePct: vePct ? Math.max(0, loaded.vePct - vePct.median) : null,
      },
      dryAtMedian: dry('median'),
      dryAtP90: dry('p90'),
    };
  });

  return {
    stops: clamped.map((c, i) => ({
      stop: i + 1,
      after: c.after,
      min: c.bounds.min,
      max: c.bounds.max,
      p90Max: c.bounds.p90Max,
      refuel: worked.row.refuel[i] ?? null,
      pitS: worked.pitS[i] ?? null,
    })),
    stints,
    finishLaps,
    finishDelta: finishLaps - estimate,
    pit:
      worked.totalS != null && base.totalS != null
        ? {totalS: worked.totalS, deltaS: worked.totalS - base.totalS}
        : null,
    moved: after.some((a, i) => a !== planned[i]),
  };
}

/**
 * The lap a pointer at `x` of a track `width` wide asks for, when the track
 * runs from `from` to `to`; whole laps, held inside the track.
 */
export function lapAt(x: number, width: number, from: number, to: number) {
  if (width <= 0) return from;
  const t = Math.min(1, Math.max(0, x / width));
  return Math.round(from + t * (to - from));
}
