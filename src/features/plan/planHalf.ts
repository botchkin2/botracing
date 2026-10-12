// The lower half of the Pit stops card, "Plan vs what happened" (round 5 item
// 3, pit-wall thread 43): the planner, fed only laps from before the race,
// against what the race did, row for row. Numbers and how they were made; no
// verdict, no difference column, no colour. Pure.
//
// The planner gives stop laps and stint lengths but not what would be left at
// a planned stop or at the flag, so those are derived here, at the median use
// per lap of the Plan screen's own per-lap number: the meter's full load minus
// the laps a stint burns times that use. They are labelled "at the median use".
import type {FuelPlan, PlanRules, RaceFacts} from '@/src/analysis/fuelPlan';

import {oneDecimal} from '@/src/design';
import type {ActualEnd, ActualStop} from '@/src/features/session/pitCard';

import {type PlanBasis, scheduledLength} from './planVsRace';

export type PlanHalfRow = {k: string; p: string; a: string};

export type PlanHalf = {
  /** "Plan = ..." or the reason there is no plan. */
  /** Why there is no plan, a few words; null when there is one. */
  note: string | null;
  rows: PlanHalfRow[];
};

const MISSING = '—';

// "4 % VE (1.1 laps)" in the VE state, "6.2 L (2.0 laps)" without VE.
function left(
  hasVe: boolean,
  value: {fuelL: number | null; vePct: number | null},
  laps: number | null,
): string {
  const v = hasVe
    ? value.vePct != null && `${Math.round(value.vePct)} % VE`
    : value.fuelL != null && `${value.fuelL.toFixed(1)} L`;
  if (!v) return MISSING;
  return laps != null ? `${v} (${laps.toFixed(1)} laps)` : v;
}

// A whole load: "100 L", "87 % VE".
const load = (hasVe: boolean, v: number) =>
  hasVe ? `${Math.round(v)} % VE` : `${Math.round(v)} L`;

/**
 * The Finish row of a DNF, one thing a column (canard's audit, #4166): the
 * plan's side is where the plan's flag falls (its own race laps, in the lap
 * table's labels: L1 is the formation lap), "—" without a plan. The race's
 * side is what happened: the player's DNF lap, and the furthest lap the class
 * leader was seen to finish, with a "+" because the recording stops with the
 * player, mid-lap for the leader (pit-wall thread 1 #3136).
 */
export function finishRow(
  facts: RaceFacts,
  /** The plan's racing laps; null without a plan. */
  planLaps: number | null,
): PlanHalfRow {
  const at = facts.playerLapsDone ?? facts.end?.lapIndex ?? null;
  const leader = facts.classLeaderLapsDone;
  const dnf = at != null ? `DNF L${at}` : 'DNF';
  return {
    k: 'Finish',
    p: planLaps != null ? `flag L${planLaps + 1}` : MISSING,
    a: leader != null ? `${dnf} · leader L${leader}+` : dnf,
  };
}

/**
 * What a load of `from` leaves after burning `burned` laps at `use` a lap, in the
 * card's meter. Never below zero: a planned stop is at the last lap the load
 * reaches, so the rest is a fraction of a lap.
 */
function planned(
  hasVe: boolean,
  from: number,
  use: number,
  burned: number,
): string {
  const remaining = Math.max(0, from - burned * use);
  const laps = remaining / use;
  return hasVe
    ? left(true, {fuelL: null, vePct: remaining}, laps)
    : left(false, {fuelL: remaining, vePct: null}, laps);
}

/**
 * The half's rows. `plan` is null when there is nothing to plan from; the
 * half then says why and has no rows. Stops are lined up by order, never by
 * how close their laps are: a planned stop and a made stop are not claimed to
 * be the same stop (camber #1250), so the missing side reads "—".
 */
export function buildPlanHalf(input: {
  facts: RaceFacts;
  plan: FuelPlan | null;
  rules: PlanRules | null;
  basis: PlanBasis;
  hasVe: boolean;
  stops: ActualStop[];
  end: ActualEnd | null;
}): PlanHalf {
  const {facts, plan, rules, basis, hasVe, stops, end} = input;
  if (facts.limitL != null && scheduledLength(facts) == null)
    // Nothing to plan from, so nothing to compare: no note either, the card
    // is left out (PitPlanHalf) unless there is a DNF to show.
    return {
      note: null,
      rows: facts.leftEarly ? [finishRow(facts, null)] : [],
    };
  if (facts.limitL == null || !rules)
    return {
      note: 'No fill limit on record for this race.',
      rows: [],
    };
  const limit = facts.limitL.toFixed(0);
  if (!plan || basis.laps === 0)
    return {
      note: `No earlier laps at the ${limit} L limit.`,
      rows: [],
    };
  const use = (hasVe ? plan.perLap.ve : plan.perLap.fuel)?.median ?? null;
  const option = plan.atMedian;
  if (use == null || use <= 0 || option.stops == null)
    return {
      note: `No ${hasVe ? 'VE' : 'fuel'} use in the earlier laps.`,
      rows: [],
    };
  const capacity = hasVe ? rules.vePct : rules.fuelL;
  const stopLaps = option.stopLaps;
  // What the car really started with, when the race records it. The plan is
  // for a full load; reading what is left against it would show a short start
  // as over-burn (bias, #498: da3e started on 87 L of a 100 L plan).
  const started = hasVe ? facts.startVePct ?? null : facts.startL;
  const actualStart = started != null && started > 0 ? started : null;

  // The plan's own race laps (the race's length at the median lap), not the
  // laps this driver completed.
  const planLaps = plan.raceLaps?.estimate ?? facts.raceLaps;
  const rows: PlanHalfRow[] = [];
  if (facts.leftEarly) rows.push(finishRow(facts, planLaps));
  if (actualStart != null && Math.abs(actualStart - capacity) >= 0.5)
    rows.push({
      k: 'Start',
      p: load(hasVe, capacity),
      a: load(hasVe, actualStart),
    });
  const count = Math.max(stopLaps.length, stops.length);
  for (let i = 0; i < count; i++) {
    const n = stopLaps[i];
    const stop = stops[i];
    rows.push({
      k: `Stop ${i + 1}`,
      // The planner counts racing laps from 1 after the formation lap; the app
      // numbers laps from the formation lap as L1, so racing lap n is L(n+1).
      p: n != null ? `after L${n + 1}` : MISSING,
      a: stop ? `after L${stop.lapIndex}` : MISSING,
    });
    // The first stint also burns the formation lap.
    const burned = n == null ? null : i === 0 ? n + 1 : n - stopLaps[i - 1];
    rows.push({
      k: 'In',
      p: burned == null ? MISSING : planned(hasVe, capacity, use, burned),
      a: stop
        ? left(hasVe, {fuelL: stop.fuelL, vePct: stop.vePct}, stop.lapsLeft)
        : MISSING,
    });
  }
  // The use a lap the plan is built on, against this race's own median.
  const own = [
    perLapRow(
      'Fuel a lap',
      plan.perLap.fuel?.median ?? null,
      facts.ownUse.fuelL,
      v => `${v.toFixed(2)} L`,
    ),
    hasVe
      ? perLapRow(
          'VE a lap',
          plan.perLap.ve?.median ?? null,
          facts.ownUse.vePct,
          v => `${oneDecimal(v)} %`,
        )
      : null,
  ].filter((r): r is PlanHalfRow => r != null);
  // What is left, both sides at the same lap: at the flag for a race that
  // finished (the plan's flag against the race's), at the end of the last
  // whole lap after a DNF (where the plan would be then, against what the car
  // had), never the plan's flag against a DNF.
  const endLap = facts.leftEarly ? facts.end?.lapIndex ?? null : null;
  const upTo = endLap != null ? endLap - 1 : planLaps;
  const lastStop = [...stopLaps].reverse().find(n => n < upTo) ?? null;
  const burnedTo = lastStop == null ? upTo + 1 : upTo - lastStop;
  // Before the plan's first stop both sides run on the first load, so the plan
  // side starts from the load the car had: the row then compares use. After a
  // planned stop the plan refuels to the full load either way.
  const from = lastStop == null ? actualStart ?? capacity : capacity;
  rows.push({
    k: endLap != null ? `Left at L${endLap}` : 'Spare',
    p: planned(hasVe, from, use, burnedTo),
    a: end ? left(hasVe, end, end.lapsLeft) : MISSING,
  });
  rows.push(...own);
  return {note: null, rows};
}

function perLapRow(
  k: string,
  planned: number | null,
  own: number | null,
  fmt: (v: number) => string,
): PlanHalfRow | null {
  if (planned == null || own == null) return null;
  return {k, p: fmt(planned), a: fmt(own)};
}
