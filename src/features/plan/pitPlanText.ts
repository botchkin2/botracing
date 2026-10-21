import {type PitPlan, type PitStint} from './pitPlan';

import {formationUseText, stintUseText} from './planCards';
import {type Unit} from './unit';

// The words of the Pit plan card, finished here so the component only draws.
// Facts and arithmetic, no advice (CODE_STANDARDS §7).

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

/** The stint after the last stop, when a tank does not reach the flag: a short fact (thread 99, #6684). */
export function finalStintWarning(p: PitPlan): string | null {
  const last = p.stints[p.stints.length - 1];
  if (last.dryAtMedian) return `Stint ${last.n} dry at median`;
  if (last.dryAtP90) return `Stint ${last.n} dry at p90`;
  return null;
}

/** The formation lap's own row, as on the Stops card ("Formation · – · 3.5 %": a lap before the green has no number); null without one. */
export function formationRow(
  p: PitPlan,
  unit: Unit,
): {label: string; laps: string; use: string; tyres: string} | null {
  const use = formationUseText(p.formation, unit);
  return use == null ? null : {label: 'Formation', laps: '–', use, tyres: '–'};
}

/** One stint's row: laps (named by `stintLaps` when given, else the count), what it uses in `unit`, the tyre laps. */
export function stintRow(
  s: PitStint,
  unit: Unit,
  lapRange?: string,
): {label: string; laps: string; use: string; tyres: string} {
  return {
    label: `Stint ${s.n}`,
    laps: lapRange ?? String(s.laps),
    use:
      stintUseText(
        unit === 've' ? s.vePct?.median ?? null : s.fuelL?.median ?? null,
        unit,
      ) ?? '–',
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
