import {planRace} from '@/src/analysis/fuelPlan';
import {trafficMedians} from '@/src/analysis/traffic';
import {raceFacts, useSession, useSessionLaps} from '@/src/data/sessions';
import {carLabel} from '@/src/design';
import {useFuelPresets} from '@/src/state/fuelPresets';

import {lastRaceOf} from './lastRace';
import {pitLaneBase, pitModelOf} from './pitBase';
import {type Combo, fuelOnly, planView, rulesFor, sessionLimitL} from './model';
import {eventLabel} from './planEvent';
import {buildPlanCards} from './planCards';
import {type Unit} from './unit';
import {usePlanHistory, usePlanLimits} from './usePlanHistory';

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
  /** The series week of the event being planned; null is the newest event at this track and car. */
  eventWeek: string | null = null,
) {
  const presets = useFuelPresets(s => s.presets);
  const activeId = useFuelPresets(s => s.activeId);
  const length = useFuelPresets(s => s.length);
  const preset = presets.find(p => p.id === activeId) ?? null;

  const limits = usePlanLimits(combo, eventWeek);
  const rules = rulesFor(preset, length, limits.lastFuel, start);
  const wantedL = rules?.rules.fuelL ?? null;
  const hist = usePlanHistory(
    combo,
    limits.limitsL,
    wantedL,
    preset,
    limits.event?.sessionIds ?? null,
  );
  const eventText = limits.event
    ? eventLabel(
        limits.event,
        limits.lastFuel ? sessionLimitL(limits.lastFuel) : null,
      )
    : null;
  const greenLaps = hist.chosen.laps;
  // The lane base comes from his own race stops here; the Plan counts no pit
  // time without it (fewer than two stops, or a class the refuel rate is not
  // measured for).
  const pitBase = pitLaneBase(
    hist.history.flatMap((s, i) =>
      hist.lapsOf.laps[i]
        ? [{sessionType: s.sessionType, laps: hist.lapsOf.laps[i]}]
        : [],
    ),
    combo?.sessions[0]?.carClass ?? '',
  );
  const plan = rules
    ? planRace(
        rules.rules,
        greenLaps,
        pitModelOf(pitBase),
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
            ratio: hist.ratio,
            lastRatio: hist.measured.find(m => m.ratio != null)?.ratio ?? null,
            drift: hist.chosen.drift,
            // Over the pooled green laps, which are comparable by construction.
            traffic: trafficMedians(
              greenLaps.map(l => ({
                timeS: l.lapTimeS,
                comparable: true,
                traffic: l.traffic ?? null,
              })),
            ),
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
  const cards =
    rules && plan
      ? buildPlanCards(
          plan,
          rules.rules,
          noVe,
          hist.ratio?.perPctL ?? null,
          unit,
          combo?.sessions[0]?.carClass ?? '',
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
    view,
    cards,
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
  const newest =
    combo?.sessions.find(
      s =>
        s.sessionType === 'R' &&
        (event == null || event.sessionIds.includes(s.id)),
    ) ?? null;
  const detail = useSession(newest?.id ?? '');
  const laps = useSessionLaps(newest?.id ?? null);
  if (!newest || !detail.data || !laps.data) return null;
  const key = `${detail.data.trackId}|${carLabel(detail.data.car).model}`;
  return lastRaceOf(newest.id, raceFacts(detail.data, key, laps.data));
}
