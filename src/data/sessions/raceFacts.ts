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
  // The service before the start is a window on the lap the race starts in
  // (L1, which holds LMU's formation, or iRacing's formation lap), which the
  // car leaves (an out lap, `pitOut`). A stop on it is a real one when the lap
  // ends in the pit lane (`pitIn`): Road Atlanta 09-25 changed the FL on L1,
  // 87 s, after a 267 s lap (camber, thread 43 #1279). Named by the lap's
  // racing number, never its place: a capture that starts late in the pits
  // (Daytona 10-07, on L2) is a stop.
  return laps.filter(
    l => l.pitStop !== null && ((l.lapNo ?? 0) > 1 || l.pitIn),
  );
}

/**
 * The race's side of the comparison, from the session's plan block (the
 * uploader worked it out off the laps: tools/sessions/planBlock.mjs). Null for
 * anything but a race with a whole lap to end on, and for a session whose
 * block is from before racing lap numbers (no data, not a guess). Laps are
 * named from the green flag (analysis/lapNumbering.ts).
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
      lap: s.lap,
      fuelL: s.fuelL,
      vePct: s.vePct,
      kind: s.kind,
      detail: s.detail,
    })),
  };
}
