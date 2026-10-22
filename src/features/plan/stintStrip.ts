// The stint strip under the stop panels (pit-wall thread 99, UX note #6729,
// gauge #6730): the race's laps as one bar, the formation a narrow cell with
// no number, each stint a block named by its laps, a tick at each stop. A tap
// on a block opens its numbers, so the phone keeps what the desktop table
// shows. Pure.
import {lapRangeLabel} from '@/src/analysis/lapNumbering';

import {type PitPlan} from './pitPlan';
import {stintLaps, stintUseText} from './planCards';
import {type StopPanel} from './stopPanels';

export type StripCell = {
  key: string;
  /** "Formation" or "L1–L19". */
  label: string;
  /** Share of the bar's width. */
  share: number;
  formation: boolean;
  /** The numbers a tap opens: laps, use, the level set at the stop that ends it; the first stint names the formation's own use too. Empty for the formation, which is too narrow to tap. */
  detail: string[];
};

/** The formation cell's share of the bar: narrow, never a lap's width of nothing. */
const FORMATION_SHARE = 0.03;

export function stintStrip(
  pit: PitPlan,
  panels: readonly StopPanel[],
  unit: 've' | 'fuel',
): StripCell[] {
  const total = pit.stints.reduce((n, s) => n + s.laps, 0);
  if (total <= 0) return [];
  const counts = pit.stints.map(s => s.laps);
  const formationUse =
    pit.formation == null
      ? null
      : unit === 've'
      ? pit.formation.vePct
      : pit.formation.fuelL;
  const cells: StripCell[] = [];
  const rest = pit.formation ? 1 - FORMATION_SHARE : 1;
  if (pit.formation)
    cells.push({
      key: 'formation',
      label: 'Formation',
      share: FORMATION_SHARE,
      formation: true,
      detail: [],
    });
  pit.stints.forEach((s, i) => {
    const use = unit === 've' ? s.vePct?.p90 : s.fuelL?.p90;
    const detail = [`${s.laps} ${s.laps === 1 ? 'lap' : 'laps'}`];
    const useText = stintUseText(use ?? null, unit);
    if (useText) detail.push(`${useText} at p90`);
    if (i === 0 && formationUse != null)
      detail.push(
        `formation ${formationUse.toFixed(1)} ${unit === 've' ? '%' : 'L'}`,
      );
    if (panels[i]) detail.push(panels[i].value);
    cells.push({
      key: `stint-${s.n}`,
      label: stintLaps(counts, i),
      share: (s.laps / total) * rest,
      formation: false,
      detail,
    });
  });
  return cells;
}

/** The whole race's laps, "L1–L30", for the strip's accessible name. */
export const stripLabel = (pit: PitPlan) =>
  lapRangeLabel(
    1,
    pit.stints.reduce((n, s) => n + s.laps, 0),
  );
