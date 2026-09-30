// The race's side of "plan vs what happened" (pit-wall thread 42): what the
// planner is compared with. Pure.
import type {RaceFacts} from '@/src/analysis/fuelPlan';
import type {Lap, SessionDetail} from '@/src/data/sessions';

import {racePitLaps} from './pitReview';

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
  session: Pick<SessionDetail, 'sessionType' | 'fuel' | 'startedAt'>,
  planKey: string,
  laps: Lap[],
): RaceFacts | null {
  if (session.sessionType !== 'R') return null;
  const ending = [...laps]
    .reverse()
    .find(l => !l.partial && l.fuel?.endL != null);
  if (!ending) return null;
  const green = laps.filter(l => l.fuel?.green && (l.fuel.usedL ?? 0) > 0);
  return {
    planKey,
    startedAt: session.startedAt,
    limitL: session.fuel?.fillLimitL ?? null,
    startL: session.fuel?.startL ?? null,
    raceLaps: Math.max(0, ending.lapIndex - 1),
    ownUse: {
      fuelL: median(green.map(l => l.fuel!.usedL as number)),
      vePct: median(
        green
          .map(l => l.fuel!.veUsedPct)
          .filter((v): v is number => v != null && v > 0),
      ),
    },
    stops: racePitLaps(session.sessionType, laps).map(l => ({
      lapIndex: l.lapIndex,
      fuelL: l.pitStop!.atEntry.fuelL,
      vePct: l.pitStop!.atEntry.vePct,
    })),
  };
}
