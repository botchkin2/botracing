// One panel per stop of the Pit plan (pit-wall thread 99, row PLN, #6684 and
// the UX note #6729): the number he puts in the pit menu as the hero, a short
// line under it, a fill bar from the arrival to the level, and the stop's
// state as a word. Pure.
import {lapLabel} from '@/src/analysis/lapNumbering';
import {stopTargets, type StopTarget} from '@/src/analysis/stopTarget';

import {type PitModel} from '@/src/analysis/fuelPlan';
import {type PitPlan} from './pitPlan';

export type StopPanel = {
  stop: number;
  /** "after L19". */
  after: string;
  /** The pit-menu number: "Set VE 62 %", "Set fuel 48 L", "Add 48 L". */
  value: string;
  /** "arrive 4 % · +58 % · 34 s"; the parts the model has. */
  line: string;
  /** The bar, as shares of a full load: what the car arrives with and the level; null for an amount to add. */
  fill: {arrive: number; set: number} | null;
  /** The stint after this stop runs dry at p90 use: the hero takes the warning tone. */
  dryAtP90: boolean;
  /** Short facts beside the number: "fuel-limited", "no fill", "no stop measured". */
  tags: string[];
};

export type StopPanelInput = {
  sim: string;
  /** VE for a car with Virtual Energy, litres otherwise. */
  meter: 've' | 'fuel';
  p90: {fuelL: number | null; vePct: number | null};
  /** The most fuel he has run in the rule set: the cap of a litre setting. */
  loadL: number;
  fullVePct: number;
  /** Litres one 1 % VE adds at a stop, from his own stops; null when none was measured. */
  stopRatio: number | null;
  /** False when the load is not known: the level is VE alone, no fuel check. */
  fuelCheck?: boolean;
  /** A timed race: the last stop covers the lap a late flag can add. */
  lateFlag: boolean;
  pitModel: PitModel | null;
};

const whole = (v: number) => String(Math.round(v));

export function stopPanels(pit: PitPlan, input: StopPanelInput): StopPanel[] {
  const {meter, loadL, fullVePct} = input;
  const arrive = pit.stints
    .slice(0, -1)
    .map(s => (meter === 've' ? s.left.vePct : s.left.fuelL));
  const arriveFuelL = pit.stints.slice(0, -1).map(s => s.left.fuelL);
  const targets = stopTargets({
    sim: input.sim,
    meter,
    stintLaps: pit.stints.map(s => s.laps),
    lateFlag: input.lateFlag,
    p90: input.p90,
    loadL,
    fullVePct,
    stopRatio: input.stopRatio,
    fuelCheck: input.fuelCheck,
    arrive,
    arriveFuelL,
  });
  const full = meter === 've' ? fullVePct : loadL;
  const unit = meter === 've' ? '%' : 'L';
  return targets.map((t, k) => {
    const stop = pit.stops[k];
    const tags: string[] = [];
    if (t.fuelLimited) tags.push('fuel-limited');
    if (t.noFill) tags.push('no fill');
    if (t.unmeasured) tags.push('no stop measured');
    return {
      stop: stop.stop,
      after: `after ${lapLabel(stop.after)}`,
      value: valueText(t),
      line: lineOf(t, unit, seconds(t, input)),
      fill:
        t.verb === 'set' && full > 0
          ? {arrive: Math.min(1, (t.arrive ?? 0) / full), set: t.value / full}
          : null,
      dryAtP90:
        pit.stints[k + 1]?.dryAtP90 === true || stop.after > stop.p90Max,
      tags,
    };
  });
}

function valueText(t: StopTarget): string {
  if (t.verb === 'add') return `Add ${whole(t.value)} L`;
  return t.meter === 've'
    ? `Set VE ${whole(t.value)} %`
    : `Set fuel ${whole(t.value)} L`;
}

/** Seconds in the pit: the lane loss and the fill the stop adds; null without a pit model. */
function seconds(t: StopTarget, input: StopPanelInput): number | null {
  const {pitModel} = input;
  if (!pitModel || t.addedL == null) return null;
  return pitModel.baseS + t.addedL / pitModel.refuelLPerS;
}

function lineOf(t: StopTarget, unit: string, s: number | null): string {
  const parts: string[] = [];
  if (t.arrive != null) parts.push(`arrive ${whole(t.arrive)} ${unit}`);
  if (t.added != null && t.verb === 'set')
    parts.push(`+${whole(t.added)} ${unit}`);
  if (s != null) parts.push(`${whole(s)} s`);
  return parts.join(' · ');
}
