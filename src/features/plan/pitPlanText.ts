import {type PitPlan, type PitStint, type SliderStop} from './pitPlan';
import {lapName} from './planCards';
import {type Unit} from './unit';

// The words of the Pit plan card, finished here so the component only draws.
// Facts and arithmetic, no advice (CODE_STANDARDS §7).

const one = (v: number) => v.toFixed(1);
const secs = (v: number) => `${Math.round(v)} s`;
const signed = (v: number, unit: string) =>
  `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))} ${unit}`;

/**
 * The one unit the card speaks in (Botkin, thread 44 #1826): VE wherever the
 * plan has VE data, fuel only without it. Both meters are still tested for
 * running dry; this only picks what is printed.
 */
export function unitOf(p: PitPlan): Unit {
  return p.stints.some(s => s.vePct) ? 've' : 'fuel';
}

/**
 * "arrives with 14.2 % VE left · adds 62.0 L · 71 s in the pit", or less when
 * the model has less. `stint` is the one that ends at this stop. The litres
 * stay: the refuel time comes from them.
 */
export function stopLine(s: SliderStop, stint: PitStint, unit: Unit): string {
  const parts: string[] = [];
  const left = unit === 've' ? stint.left.vePct : stint.left.fuelL;
  if (left != null)
    parts.push(
      `arrives with ${one(left)} ${unit === 've' ? '% VE' : 'L'} left`,
    );
  if (s.refuel)
    parts.push(
      `adds ${one(s.refuel.litres)} L${s.refuel.toFinish ? ' to finish' : ''}`,
    );
  if (s.pitS != null) parts.push(`${secs(s.pitS)} in the pit`);
  return parts.join(' · ');
}

/** The stint after the last stop, when a tank does not reach the flag: the fact, at the median and at p90. */
export function finalStintWarning(p: PitPlan): string | null {
  const last = p.stints[p.stints.length - 1];
  if (last.dryAtMedian)
    return `Stint ${last.n} runs dry before the flag at the median use.`;
  if (last.dryAtP90)
    return `At p90 use stint ${last.n} runs dry before the flag: a tank covers fewer laps in the heavier 10 % of the laps.`;
  return null;
}

/** The p90 fact for a stop past its safe end; null inside it. */
export function stopWarning(s: SliderStop): string | null {
  return s.after > s.p90Max
    ? `At p90 use the tank is empty after ${lapName(
        s.p90Max,
      )}: this stint runs dry in the heavier 10 % of the laps.`
    : null;
}

/** One stint's row: laps, what it uses in `unit`, the tyre laps. */
export function stintRow(
  s: PitStint,
  unit: Unit,
): {label: string; laps: string; use: string; tyres: string} {
  return {
    label: `Stint ${s.n}`,
    laps: String(s.laps),
    use:
      unit === 've'
        ? s.vePct
          ? `${one(s.vePct.median)} %`
          : '–'
        : s.fuelL
        ? `${one(s.fuelL.median)} L`
        : '–',
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
