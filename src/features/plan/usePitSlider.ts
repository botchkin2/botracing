import {useMemo, useState} from 'react';

import {pitModelOf} from './pitBase';
import {pitPlan, type PitPlanInput, plannedStops} from './pitPlan';
import {stintStrip, stripLabel} from './stintStrip';
import {stopPanels} from './stopPanels';
import {type usePlanData} from './usePlanData';

/**
 * The pit-lap slider's state over the Plan's data (pit-wall thread 44 #1812):
 * the stops moved, and the plan they make. Nothing is stored: a new
 * track, car, rule set or length is a new plan, so the stops go back to it.
 * `pit` is null where there is no stop to move.
 */
export function usePitSlider(
  data: ReturnType<typeof usePlanData>,
  comboKey: string,
) {
  const {plan, rules, cards, fuelOnly, pitBase, refuelRate, hist} = data;
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
            pitModel: pitModelOf(pitBase, refuelRate),
            windows,
          }
        : null,
    [plan, rules, windows, fuelOnly, hist.ratio, pitBase, refuelRate],
  );
  const pit = useMemo(
    () => (input ? pitPlan(input, chosen) : null),
    [input, chosen],
  );
  // The car decides the meter (thread 99, #6684): VE where the plan has it.
  const meter: 've' | 'fuel' =
    plan?.perLap.ve != null && !fuelOnly ? 've' : 'fuel';
  const panels = useMemo(
    () =>
      pit && input
        ? stopPanels(pit, {
            // The combo key starts with the sim's track id ("lmu-…", "iracing-…").
            sim: comboKey.split('-')[0],
            meter,
            p90: {
              fuelL: input.plan.perLap.fuel?.p90 ?? null,
              vePct: input.plan.perLap.ve?.p90 ?? null,
            },
            fillLimitL: input.rules.fuelL,
            fullVePct: input.rules.vePct,
            lateFlag: input.plan.raceLaps?.oneMore != null,
            pitModel: input.pitModel,
          })
        : [],
    [pit, input, meter, comboKey],
  );
  const strip = useMemo(
    () => (pit ? stintStrip(pit, panels, meter) : []),
    [pit, panels, meter],
  );
  return {
    pit,
    panels,
    strip,
    stripLabel: pit ? stripLabel(pit) : '',
    meter,
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
