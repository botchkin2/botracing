import {shortTrackName} from '@/src/design';
import {type Combo} from '@/src/workspace/planCombo';

// Which state the Plan is in for a track and car, and the label that names
// it. Pure; the screen only picks what to draw from `PlanState` (owner's note
// M11, roadmap row J: an undriven track shows one clear empty state).

/**
 * - `undriven`: no session of his at this track in this car.
 * - `no-laps`: sessions, but no green laps the plan can read.
 * - `needs-fuel`: sessions, but no max fuel is known yet.
 * - `ready`: the plan cards have numbers.
 */
export type PlanState = 'undriven' | 'no-laps' | 'needs-fuel' | 'ready';

/** The combos the track and car pickers list: his own, and the undriven one in force. */
export function pickerCombos(combos: Combo[], current: Combo): Combo[] {
  return combos.some(c => c.key === current.key)
    ? combos
    : [current, ...combos];
}

export function planState(input: {
  combo: Combo;
  /** Green laps the plan reads; null while no plan is built (no rules). */
  planLaps: number | null;
  rulesKnown: boolean;
}): PlanState {
  if (input.combo.sessions.length === 0) return 'undriven';
  if (input.planLaps === 0) return 'no-laps';
  if (!input.rulesKnown) return 'needs-fuel';
  return 'ready';
}

/** The label that names an empty state; null when the plan has numbers. */
export function planStateTitle(state: PlanState, combo: Combo): string | null {
  switch (state) {
    case 'undriven':
      return `No sessions at ${shortTrackName(combo.track)} in ${combo.car}`;
    case 'no-laps':
      return 'No green laps to plan from yet';
    case 'needs-fuel':
      return 'Max fuel is needed';
    case 'ready':
      return null;
  }
}

/** Whether the cards computed from his laps (Race, Pit plan, class timing, use scatter) are drawn. */
export const showsLapCards = (state: PlanState) => state === 'ready';
