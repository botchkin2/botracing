// Facts about a race read straight off its laps, shared by the Session screen
// (pit stops card, plan vs what happened) and the Plan screen ("your last race
// here"). Pure.
import type {RaceFacts} from '@/src/analysis/fuelPlan';

import type {Lap, SessionType} from './adapters';
import type {PlanBlock} from './planBlock';

/**
 * The lap the race ends on: the last one that was not cut short and has a
 * fuel level. `Lap.partial` also carries the game's "incomplete" flag, which
 * LMU sets on the untimed last laps of a race (Le Mans 09-21: L21-L23), so
 * the test is the uploader's own "partial" reason, not that flag (#160).
 */
export function endingLap(laps: Lap[]): Lap | null {
  return (
    [...laps]
      .reverse()
      .find(l => !l.reasons.includes('partial') && l.fuel?.endL != null) ?? null
  );
}

/**
 * The stops of a race, in driving order. The service before the start is not
 * a stop and is left out (camber, thread 36 #1117). Practice and qualifying
 * have none.
 */
export function racePitLaps(sessionType: SessionType, laps: Lap[]): Lap[] {
  if (sessionType !== 'R') return [];
  const first = laps.length > 0 ? laps[0].lapIndex : 0;
  // The service before the start is a window on the first lap that the car
  // leaves (an out lap, `pitOut`), before any timed lap. A stop on the first
  // lap is a real one when the lap ends in the pit lane (`pitIn`): Road
  // Atlanta 09-25 changed the FL on L1, 87 s, after a 267 s lap (camber,
  // thread 43 #1279).
  return laps.filter(
    l => l.pitStop !== null && (l.lapIndex !== first || l.pitIn),
  );
}

/**
 * The race's side of the comparison, from the session's plan block (the
 * uploader worked it out off the laps: tools/sessions/planBlock.mjs). Null for
 * anything but a race with a whole lap to end on, and for a session uploaded
 * before the block existed (no data, not a guess). Lap numbers count from the
 * first racing lap: the formation lap is lap 0.
 */
export function raceFactsOfPlan(
  session: {startedAt: string; plan: PlanBlock | null},
  planKey: string,
): RaceFacts | null {
  const plan = session.plan;
  const race = plan?.race;
  if (!plan || !race) return null;
  return {
    planKey,
    startedAt: session.startedAt,
    limitL: plan.fuel.fillLimitL,
    startL: plan.fuel.startL,
    startVePct: race.startVePct,
    raceLaps: race.raceLaps,
    race: race.minutes != null ? {minutes: race.minutes} : null,
    leftEarly: race.leftEarly,
    playerLapsDone: race.playerLapsDone,
    classLeaderLapsDone: race.classLeaderLapsDone,
    ownUse: race.ownUse,
    end: race.end,
    stops: race.stops.map(s => ({
      lapIndex: s.lapIndex,
      fuelL: s.fuelL,
      vePct: s.vePct,
    })),
  };
}
