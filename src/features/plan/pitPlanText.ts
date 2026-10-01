import {type PitPlan, type PitStint, type SliderStop} from './pitPlan';
import {lapName} from './planCards';

// The words of the Pit plan card, finished here so the component only draws.
// Facts and arithmetic, no advice (CODE_STANDARDS §7).

const one = (v: number) => v.toFixed(1);
const secs = (v: number) => `${Math.round(v)} s`;
const signed = (v: number, unit: string) =>
  `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))} ${unit}`;

/** "adds 62.0 L · 71 s in the pit", or less when the model has less. */
export function stopLine(s: SliderStop): string {
  const parts: string[] = [];
  if (s.refuel)
    parts.push(
      `adds ${one(s.refuel.litres)} L${s.refuel.toFinish ? ' to finish' : ''}`,
    );
  if (s.pitS != null) parts.push(`${secs(s.pitS)} in the pit`);
  return parts.join(' · ');
}

/** The p90 fact for a stop past its safe end; null inside it. */
export function stopWarning(s: SliderStop): string | null {
  return s.after > s.p90Max
    ? `At p90 use the tank is empty after ${lapName(
        s.p90Max,
      )}: this stint runs dry in the heavier 10 % of the laps.`
    : null;
}

/** One stint's row: laps, what it uses, the tyre laps. */
export function stintRow(s: PitStint): {
  label: string;
  laps: string;
  fuel: string;
  ve: string;
  tyres: string;
} {
  return {
    label: `Stint ${s.n}`,
    laps: String(s.laps),
    fuel: s.fuelL ? `${one(s.fuelL.median)} L` : '–',
    ve: s.vePct ? `${one(s.vePct.median)} %` : '–',
    tyres: `${s.tyreLaps.onSet} · ${s.tyreLaps.sinceStart}`,
  };
}

/** The finish and the pit time, against the Race card's plan. */
export function finishLine(p: PitPlan): string {
  const finish = `Finish after ${p.finishLaps} laps${
    p.finishDelta !== 0
      ? ` (${signed(p.finishDelta, 'laps')} on the Race card)`
      : ''
  }`;
  const pit = p.pit
    ? ` · stops cost ${secs(p.pit.totalS)}${
        Math.round(p.pit.deltaS) !== 0
          ? ` (${signed(p.pit.deltaS, 's')} on the plan)`
          : ''
      }`
    : '';
  return finish + pit + '.';
}

export const PIT_PLAN_EXPLAINER =
  'Move a stop over its window: the stints, what each uses, what each stop adds and the finish follow. The filled part of a bar is the safe end (p90 use), the outlined part runs to where the tank is empty at the median use; the grey tick is the planned lap. In a timed race the pit time moves the finish. Tyre laps: on a set changed at the stop that starts the stint · since the start if never changed.';
