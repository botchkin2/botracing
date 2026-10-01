import {useMemo, useState} from 'react';

import {pitModelOf} from './pitBase';
import {pitPlan, type PitPlanInput, plannedStops} from './pitPlan';
import {type usePlanData} from './usePlanData';

/**
 * The pit-lap slider's state over the Plan's data (pit-wall thread 44 #1812):
 * the stops he has moved, and the plan they make. Nothing is stored: a new
 * track, car, rule set or length is a new plan, so the stops go back to it.
 * `pit` is null where there is no stop to move.
 */
export function usePitSlider(
  data: ReturnType<typeof usePlanData>,
  comboKey: string,
) {
  const {plan, rules, cards, fuelOnly, pitBase, hist} = data;
  const windows = cards?.stops.windows;
  const planned = useMemo(() => plannedStops(windows ?? []), [windows]);
  const planKey = `${comboKey}|${planned.join(',')}`;
  const [moved, setMoved] = useState<{key: string; stops: number[]} | null>(
    null,
  );
  const chosen = moved?.key === planKey ? moved.stops : null;
  const input = useMemo<PitPlanInput | null>(
    () =>
      plan && rules && windows
        ? {
            plan,
            rules: rules.rules,
            fuelOnly,
            ratioPerPctL: hist.ratio?.perPctL ?? null,
            pitModel: pitModelOf(pitBase),
            windows,
          }
        : null,
    [plan, rules, windows, fuelOnly, hist.ratio, pitBase],
  );
  const pit = useMemo(
    () => (input ? pitPlan(input, chosen) : null),
    [input, chosen],
  );
  return {
    pit,
    planned,
    /** Ask for stop `stop` (1-based) after `lap`; the plan clamps it and the stops after it. */
    setStop(stop: number, lap: number) {
      if (!input || !pit) return;
      const asked = pit.stops.map(s => s.after);
      asked[stop - 1] = lap;
      const next = pitPlan(input, asked);
      if (next) setMoved({key: planKey, stops: next.stops.map(s => s.after)});
    },
    reset: () => setMoved(null),
  };
}
