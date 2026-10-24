// The number he puts in the pit menu at each stop (pit-wall thread 99, row
// PLN, design #6684). LMU fills TO a level: the VE target is what the car
// leaves with, and a target under what it arrives with adds nothing (relative
// refuelling went in Patch 2, Mar 2024). Fuel follows VE at the litres each
// 1 % VE adds at a stop (his setup's fuel ratio, measured from his own stops:
// not the fill limit over 100, which is 0.75 against 0.61 L a % at Sebring).
// A car without VE (LMP2) sets litres the same way. iRacing adds an amount.
//
// The level covers the laps from this stop to the next one (or to the flag,
// plus the lap a timed race's late flag can add) at the p90 use, the plan's
// own margin. VE covers it from the VE use; fuel covers it from what the car
// arrives with plus what the stop adds at the stop ratio, and the level is the
// higher of the two. Rounded up to a
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
  /** The litres the stop puts in; null for a VE stop whose litres per % were never measured. */
  addedL: number | null;
  /** A VE stop with no measured stop ratio: the level is VE only and the litres are not known. */
  unmeasured: boolean;
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
  /** The most fuel he has run in the rule set: the cap of a litre setting. */
  loadL: number;
  /** A full VE load, % (100 unless the event caps it). */
  fullVePct: number;
  /** Litres one 1 % VE adds at a stop (his own stops); null when no stop was measured. */
  stopRatio: number | null;
  /** What the car arrives with at each stop, in `meter`; null where not known. */
  arrive: readonly (number | null)[];
  /** What the car arrives with at each stop in litres; null where not known. */
  arriveFuelL: readonly (number | null)[];
};

/** One target per stop, in stop order; none without the meter's p90 use. */
export function stopTargets(input: StopTargetInput): StopTarget[] {
  const {meter, stintLaps, p90, loadL, fullVePct, stopRatio} = input;
  const verb = input.sim === 'iracing' ? 'add' : 'set';
  const out: StopTarget[] = [];
  for (let k = 0; k + 1 < stintLaps.length; k++) {
    const last = k + 2 === stintLaps.length;
    const lapsAfter = stintLaps[k + 1] + (last && input.lateFlag ? 1 : 0);
    const arrive = input.arrive[k] ?? null;
    const arriveFuelL = input.arriveFuelL[k] ?? null;
    let need: number;
    let cap: number;
    let fuelLimited = false;
    if (meter === 've') {
      if (p90.vePct == null) return [];
      const veNeed = lapsAfter * p90.vePct;
      // The level that puts in the litres the laps burn over what is left:
      // the arrival plus the shortfall over the litres one % adds here.
      const fuelNeed =
        p90.fuelL == null ||
        stopRatio == null ||
        !(stopRatio > 0) ||
        arrive == null ||
        arriveFuelL == null
          ? 0
          : arrive + (lapsAfter * p90.fuelL - arriveFuelL) / stopRatio;
      // Within one step of the pit menu the two ratios (the track's and the
      // stops') are noise, not a limiter: the level still takes the higher.
      fuelLimited = fuelNeed - veNeed >= 1;
      need = Math.max(veNeed, fuelNeed);
      cap = fullVePct;
    } else {
      if (p90.fuelL == null) return [];
      need = lapsAfter * p90.fuelL;
      cap = loadL;
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
        addedL: value,
        unmeasured: false,
        fuelLimited,
        noFill: value <= 0,
      });
      continue;
    }
    const level = Math.min(cap, wholeUp(need));
    const noFill = arrive != null && arrive >= level;
    const added = arrive == null ? null : Math.max(0, level - arrive);
    out.push({
      meter,
      verb,
      value: level,
      arrive,
      added,
      // VE adds litres at the stop ratio, a litre setting is the litres
      addedL:
        meter === 'fuel'
          ? added
          : added == null || stopRatio == null
          ? null
          : added * stopRatio,
      unmeasured: meter === 've' && stopRatio == null,
      fuelLimited,
      noFill,
    });
  }
  return out;
}

// Up to the next whole number, with a hair of slack so 60.000000001 stays 60.
const wholeUp = (x: number) => Math.ceil(x - 1e-9);
