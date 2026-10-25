import {planRace, usage} from '@/src/analysis/fuelPlan';
import {raceFactsOfPlan} from '@/src/data/sessions';
import {planComboKey} from '@/src/nav/routes';
import {useFuelPresets} from '@/src/state/fuelPresets';

import {formationBurnOf} from './formation';
import {lastRaceOf, lastRaceSessionOf} from './lastRace';
import {pitLaneBase, pitModelOf, refuelRateFor} from './pitBase';
import {type Combo, fuelOnly, planView, rulesFor, sessionLimitL} from './model';
import {planChecks} from './planChecks';
import {checksText} from './planChecksText';
import {eventLabel} from './planEvent';
import {buildPlanCards} from './planCards';
import {type Unit} from './unit';
import {usePlanHistory, usePlanLimits, usePlanRows} from './usePlanHistory';

/**
 * Everything the Plan screen shows for one track and car, as data: the rules
 * in force, the history and the laps chosen from it, the plan, its row text
 * and the typed cards. The Plan screen, the Track page's Plan card and the
 * practice lines read it through this hook, so they all give the Plan
 * screen's own numbers (pit-wall thread 43 #1244).
 */
export function usePlanData(
  combo: Combo | null,
  unit: Unit = 've',
  /** What the car starts with when less than a full load, typed for this race. */
  start: {fuelL?: number | null; vePct?: number | null} = {},
  /** The key of the event being planned (its rule set); null is the newest event at this track and car. */
  eventKey: string | null = null,
) {
  const presets = useFuelPresets(s => s.presets);
  const activeId = useFuelPresets(s => s.activeId);
  const length = useFuelPresets(s => s.length);
  const preset = presets.find(p => p.id === activeId) ?? null;

  const limits = usePlanLimits(combo, eventKey);
  // The litres 100 % VE allows in the planned rule set: with no load known the
  // plan runs on VE alone (a practice-only week, thread 104).
  const ruleSet = limits.event?.rules ?? null;
  const baseRules = rulesFor(
    preset,
    length,
    limits.lastFuel,
    start,
    ruleSet != null,
  );
  // the litres a % of VE adds at his stops: a stop's litres when no load is known
  if (baseRules) baseRules.rules.stopRatioL = ruleSet?.stopRatio ?? null;
  const hist = usePlanHistory(
    combo,
    limits.limitsL,
    baseRules != null,
    preset,
    limits.event?.sessionIds ?? null,
    limits.event?.rules ?? null,
  );
  const eventText = limits.event
    ? eventLabel(
        limits.event,
        limits.lastFuel ? sessionLimitL(limits.lastFuel) : null,
      )
    : null;
  const greenLaps = hist.chosen.laps;
  // The formation lap burns what the driver's own races say, not a green lap.
  const formation = formationBurnOf(
    hist.formationBurnsL,
    usage(greenLaps.map(l => l.fuelL))?.median ?? null,
  );
  const rules = baseRules && {
    ...baseRules,
    rules: {...baseRules.rules, formationFactor: formation.factor},
  };
  // The refuel rate and the lane base come from his own race stops here; the
  // Plan counts no pit time without them (fewer than two service stops, or no
  // fill measured and a class with no default rate).
  const carClass = combo?.sessions[0]?.carClass ?? '';
  const refuelRate = refuelRateFor(hist.races, carClass);
  const pitBase = pitLaneBase(hist.races, refuelRate);
  const plan = rules
    ? planRace(
        rules.rules,
        greenLaps,
        pitModelOf(pitBase, refuelRate),
        hist.ratio?.perPctL ?? null,
      )
    : null;
  // Chosen from the data, never from the car class (camber, thread 43 #1243).
  const noVe = fuelOnly(greenLaps);
  const view =
    rules && plan
      ? planView(
          preset,
          rules,
          plan,
          {
            since:
              hist.usedSessions.length > 0
                ? hist.usedSessions[hist.usedSessions.length - 1].startedAt
                : null,
            lastFillLimitL: limits.lastFuel?.fillLimitL ?? null,
            eventText,
            ruleSet: ruleSet != null,
            ratio: hist.ratio,
            lastRatio: hist.measured.find(m => m.ratio != null)?.ratio ?? null,
            drift: hist.chosen.drift,
            ratioLoadsL: [
              ...new Set(
                hist.measured
                  .filter(m => m.ratio != null && m.fillLimitL != null)
                  .map(m => m.fillLimitL as number),
              ),
            ],
          },
          unit,
        )
      : null;
  // What the facts rest on: only for a rule set (a series week has no sources to compare).
  const checks =
    ruleSet && plan
      ? checksText(
          planChecks({
            set: ruleSet,
            sessions: limits.runs,
            measured: {
              fuelPerLapL: plan.perLap.fuel?.median ?? null,
              vePerLapPct: plan.perLap.ve?.median ?? null,
            },
            ownIds: hist.usedSessions.map(s => s.id),
          }),
        )
      : null;
  const cards =
    rules && plan
      ? buildPlanCards(
          plan,
          rules.rules,
          noVe,
          hist.ratio?.perPctL ?? null,
          unit,
          refuelRate,
        )
      : null;
  return {
    preset,
    length,
    rules,
    limits,
    hist,
    greenLaps,
    plan,
    pitBase,
    refuelRate,
    view,
    checks,
    cards,
    formation,
    fuelOnly: noVe,
    eventText,
  };
}

/**
 * The newest race of the planned event at a track and car (the series is the
 * unit, not the track: pit-wall thread 44 #1967), for "Your last race here".
 * Null while it loads, and when the event has no race yet. With no event given
 * it is the newest race at the track and car.
 */
export function useLastRaceHere(
  combo: Combo | null,
  event: {sessionIds: string[]} | null = null,
) {
  const rows = usePlanRows(combo);
  const newest = combo ? lastRaceSessionOf(combo.sessions, event) : null;
  const row = newest ? rows.byId.get(newest.id) : undefined;
  if (!combo || !newest || !row) return null;
  const key = planComboKey(combo.trackId, combo.car, combo.sim);
  return lastRaceOf(newest.id, raceFactsOfPlan(row, key));
}
