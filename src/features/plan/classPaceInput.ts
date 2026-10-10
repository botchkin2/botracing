import {paceClass} from '@/src/analysis/classLaps';
import {type SessionSummary} from '@/src/data/sessions';

import {type ClassTimingInput, classSessionOf} from './classTiming';
import {type Combo, HISTORY_SESSIONS} from './model';

// The session list and the plan in force, as the class pace model reads them.
// Pure: useClassTiming only gathers these inputs.

/** What the plan says about his pace and the race; null before a plan is built (no fuel rules). */
export type PlanPace = {
  medianLapS: number | null;
  greenLaps: number;
  sessions: number;
  raceLaps: number | null;
  stopsAfter: number[];
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = (v.length - 1) / 2;
  return (v[Math.floor(mid)] + v[Math.ceil(mid)]) / 2;
}

export function classPaceInput(input: {
  combo: Combo;
  /** Every session he has, any track. */
  sessions: SessionSummary[];
  plan: PlanPace | null;
  /** The pit-lap slider's stops and finish, in place of the plan's own. */
  chosen: {raceLaps: number; stopsAfter: number[]} | null;
}): ClassTimingInput {
  const {combo, sessions, plan, chosen} = input;
  const pool = sessions.flatMap(s => {
    const here =
      s.sim === combo.sim &&
      s.trackId === combo.trackId &&
      (s.sessionType === 'R' || s.sessionType === 'P');
    const c = here ? classSessionOf(s) : null;
    return c ? [c] : [];
  });

  // His class: the field's own flag on the newest session that names it
  // (iRacing's short name says little), else the car's class as the sim wrote it.
  const flagged = combo.sessions.find(s => s.classLaps?.player != null);
  const carClass = combo.sessions[0]?.carClass ?? '';
  const key =
    flagged?.classLaps?.player ?? (carClass ? paceClass(carClass) : null);

  // His median: the plan's, over the green laps it reads. With no plan (no fuel
  // rules) or a plan with no green laps under its rules, the median of his
  // newest sessions' medians stands in, pooled the way the classes are.
  const recent = combo.sessions.slice(0, HISTORY_SESSIONS);
  const medians = recent.flatMap(s =>
    s.medianTimeS == null ? [] : [s.medianTimeS],
  );
  const mine =
    plan?.medianLapS != null
      ? {
          medianLapS: plan.medianLapS,
          laps: plan.greenLaps,
          sessions: plan.sessions,
        }
      : {
          medianLapS: median(medians),
          laps: recent.reduce((a, s) => a + s.comparableCount, 0),
          sessions: medians.length,
        };

  return {
    sessions: pool,
    mine: {key, ...mine},
    raceLaps: chosen?.raceLaps ?? plan?.raceLaps ?? null,
    stopsAfter: chosen?.stopsAfter ?? plan?.stopsAfter ?? [],
  };
}
