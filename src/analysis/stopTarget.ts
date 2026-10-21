// The number he puts in the pit menu at each stop (pit-wall thread 99, row
// PLN, design #6684). LMU fills TO a level: the VE target is what the car
// leaves with, and a target under what it arrives with adds nothing (relative
// refuelling went in Patch 2, Mar 2024). Fuel follows VE on the event's scale:
// X % VE loads X % of the fill limit. A car without VE (LMP2) sets litres the
// same way: Patch 2 removed relative refuelling from the whole pit menu, and
// his first LMP2 race stop will check it from data (splash, thread 99).
// iRacing adds an amount.
//
// The level covers the laps from this stop to the next one (or to the flag,
// plus the lap a timed race's late flag can add) at the p90 use, the plan's
// own margin; it never depends on what the car arrives with. Rounded up to a
// whole %: LMU's pit menu steps VE by 1 % (Botkin, thread 99 #6705), and by
// whole litres for a fuel-only car. Pure.

export type StopTarget = {
  /** What the number is in: VE % for a VE car, litres otherwise. */
  meter: 've' | 'fuel';
  /** 'set' fills to `value` (LMU); 'add' puts `value` in (iRacing). */
  verb: 'set' | 'add';
  /** The pit-menu number: the level to fill to, or the litres to add. */
  value: number;
  /** What the car arrives with in `meter`; null without a model. */
  arrive: number | null;
  /** What the stop puts in, in `meter`: the level less the arrival, never below 0. */
  added: number | null;
  /** Fuel runs out before VE over the laps after the stop, so the level is sized from fuel. */
  fuelLimited: boolean;
  /** The car arrives at or above the level: the game adds nothing. */
  noFill: boolean;
};

export type StopTargetInput = {
  sim: string;
  meter: 've' | 'fuel';
  /** Racing laps of each stint, first to last; one stop between each pair. */
  stintLaps: readonly number[];
  /** A timed race: the flag can fall a lap late, so the last stint covers one more. */
  lateFlag: boolean;
  /** Use per lap at p90; the meter's own must be there. */
  p90: {fuelL: number | null; vePct: number | null};
  /** The most fuel the event lets the car take: what 100 % VE loads. */
  fillLimitL: number;
  /** A full VE load, % (100 unless the event caps it). */
  fullVePct: number;
  /** What the car arrives with at each stop, in `meter`; null where not known. */
  arrive: readonly (number | null)[];
};

/** One target per stop, in stop order; none without the meter's p90 use. */
export function stopTargets(input: StopTargetInput): StopTarget[] {
  const {meter, stintLaps, p90, fillLimitL, fullVePct} = input;
  const verb = input.sim === 'iracing' ? 'add' : 'set';
  const out: StopTarget[] = [];
  for (let k = 0; k + 1 < stintLaps.length; k++) {
    const last = k + 2 === stintLaps.length;
    const lapsAfter = stintLaps[k + 1] + (last && input.lateFlag ? 1 : 0);
    const arrive = input.arrive[k] ?? null;
    let need: number;
    let cap: number;
    let fuelLimited = false;
    if (meter === 've') {
      if (p90.vePct == null) return [];
      const veNeed = lapsAfter * p90.vePct;
      // The fuel those laps burn, on the VE scale: X % loads X % of the limit.
      const fuelNeed =
        p90.fuelL == null || !(fillLimitL > 0)
          ? 0
          : ((lapsAfter * p90.fuelL) / fillLimitL) * fullVePct;
      fuelLimited = fuelNeed > veNeed;
      need = Math.max(veNeed, fuelNeed);
      cap = fullVePct;
    } else {
      if (p90.fuelL == null) return [];
      need = lapsAfter * p90.fuelL;
      cap = fillLimitL;
    }
    if (verb === 'add') {
      // iRacing: the litres to put in over what is left, within the tank.
      const room = arrive == null ? cap : cap - arrive;
      const value = Math.min(room, wholeUp(Math.max(0, need - (arrive ?? 0))));
      out.push({
        meter,
        verb,
        value,
        arrive,
        added: value,
        fuelLimited,
        noFill: value <= 0,
      });
      continue;
    }
    const level = Math.min(cap, wholeUp(need));
    const noFill = arrive != null && arrive >= level;
    out.push({
      meter,
      verb,
      value: level,
      arrive,
      added: arrive == null ? null : Math.max(0, level - arrive),
      fuelLimited,
      noFill,
    });
  }
  return out;
}

// Up to the next whole number, with a hair of slack so 60.000000001 stays 60.
const wholeUp = (x: number) => Math.ceil(x - 1e-9);
