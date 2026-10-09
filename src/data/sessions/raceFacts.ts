// Facts about a race read straight off its laps, shared by the Session screen
// (pit stops card, plan vs what happened) and the Plan screen ("your last race
// here"). Pure.
import type {RaceFacts} from '@/src/analysis/fuelPlan';

import type {Lap, SessionDetail, SessionType} from './adapters';

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

const MIN_OWN_LAPS = 3;

function median(values: number[]): number | null {
  if (values.length < MIN_OWN_LAPS) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * The race's side of the comparison. Null for anything but a race with a
 * whole lap to end on. Lap numbers count from the first racing lap: the
 * formation lap is lap 0, so the lap index minus one (the same count the
 * planner and the backtest use).
 */
export function raceFacts(
  session: Pick<
    SessionDetail,
    'sessionType' | 'fuel' | 'startedAt' | 'finish'
  > &
    Partial<Pick<SessionDetail, 'race'>>,
  planKey: string,
  laps: Lap[],
): RaceFacts | null {
  if (session.sessionType !== 'R') return null;
  const ending = endingLap(laps);
  if (!ending) return null;
  const endFuel = ending.fuel;
  const green = laps.filter(l => l.fuel?.green && (l.fuel.usedL ?? 0) > 0);
  return {
    planKey,
    startedAt: session.startedAt,
    limitL: session.fuel?.fillLimitL ?? null,
    startL: session.fuel?.startL ?? null,
    // The first recorded lap's VE at the start (the formation lap, where it
    // is recorded): what the car started the race on.
    startVePct:
      [...laps].sort((a, b) => a.lapIndex - b.lapIndex)[0]?.fuel?.veStartPct ??
      null,
    raceLaps: Math.max(0, ending.lapIndex - 1),
    race: session.race ?? null,
    leftEarly: session.finish?.leftEarly === true,
    playerLapsDone: session.finish?.lapsDone ?? null,
    leaderLapsDone: session.finish?.leaderLapsDone ?? null,
    ownUse: {
      fuelL: median(green.map(l => l.fuel!.usedL as number)),
      vePct: median(
        green
          .map(l => l.fuel!.veUsedPct)
          .filter((v): v is number => v != null && v > 0),
      ),
    },
    end: {
      lapIndex: ending.lapIndex,
      fuelL: endFuel?.endL ?? null,
      vePct: endFuel?.veEndPct ?? null,
    },
    stops: racePitLaps(session.sessionType, laps).map(l => ({
      lapIndex: l.lapIndex,
      fuelL: l.pitStop!.atEntry.fuelL,
      vePct: l.pitStop!.atEntry.vePct,
    })),
  };
}
