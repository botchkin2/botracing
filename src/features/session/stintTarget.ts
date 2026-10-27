// How each stint of a race ended (pit-wall thread 121, decisions/lap/2026-10-27-
// stint-fuel-card.md): a stint that ends in a stop shows what was left in the
// car at the pit entry; the stint that ends at the flag shows the use a lap it
// needed to get there on what was in the car, and what was left at the flag.
// Both read the lap docs' stored levels; nothing is estimated.
import type {Lap, SessionDetail} from '@/src/data/sessions';
import {endingLap, racePitLaps} from '@/src/data/sessions/raceFacts';

export type StintTarget =
  /** The level left at the pit entry that ends the stint. */
  | {kind: 'stop'; left: number}
  /**
   * The stint to the flag: the use a lap that spreads what the car started the
   * stint with over the laps it ran, and the level left at the flag.
   */
  | {kind: 'flag'; needed: number; atFlag: number};

type Unit = 've' | 'fuel';

/** The level a lap doc's fuel block holds, in the card's unit. */
const startLevel = (lap: Lap, unit: Unit) =>
  unit === 've' ? lap.fuel?.veStartPct : lap.fuel?.startL;
const endLevel = (lap: Lap, unit: Unit) =>
  unit === 've' ? lap.fuel?.veEndPct : lap.fuel?.endL;

/**
 * A stop that ends a stint is a service or a repair (or an old session whose
 * visit is not known): a drive-through or a penalty served leaves the tank as
 * it was and is not where a save is judged.
 */
const isStop = (lap: Lap) => {
  const kind = lap.pitStop?.visit?.kind;
  return kind == null || kind === 'service' || kind === 'repair';
};

/**
 * The stint a stop ended. The game's pit-in lap is the stint's last lap, or,
 * when the stop lap is also the pit-out lap (LMU), already the next stint's
 * first: then it is the stint of the lap before.
 */
function stintEndedBy(stopLap: Lap, laps: Lap[]): number | null {
  if (!stopLap.pitOut) return stopLap.stint;
  const before = laps.find(l => l.lapIndex === stopLap.lapIndex - 1);
  return before?.stint ?? null;
}

/** Stint number to target, for the stints of a race that have one. */
export function stintTargets(
  session: Pick<SessionDetail, 'plan'>,
  laps: Lap[],
  unit: Unit,
): Map<number, StintTarget> {
  const out = new Map<number, StintTarget>();
  for (const lap of racePitLaps('R', laps)) {
    const stop = lap.pitStop;
    if (!stop || !isStop(lap)) continue;
    const ended = stintEndedBy(lap, laps);
    const left = unit === 've' ? stop.atEntry.vePct : stop.atEntry.fuelL;
    if (ended != null && left != null) out.set(ended, {kind: 'stop', left});
  }
  // A race that was left before the flag has no flag to reach.
  if (session.plan?.race?.leftEarly) return out;
  const end = endingLap(laps);
  if (!end || out.has(end.stint)) return out;
  // The lap that holds a stop and the pit-out lap start before the refuel
  // (LMU's one lap that is both pit-in and pit-out; Road Atlanta 09-25: the
  // out lap starts on 2.5 % and ends on 51.8 %), so the stint's level is read
  // from the first lap after them.
  const inStint = laps
    .filter(
      l =>
        l.stint === end.stint &&
        l.lapIndex <= end.lapIndex &&
        l.pitStop == null &&
        !l.pitOut,
    )
    .sort((a, b) => a.lapIndex - b.lapIndex);
  const first = inStint.find(l => startLevel(l, unit) != null);
  const atFlag = endLevel(end, unit);
  if (!first || atFlag == null) return out;
  const lapsRun = inStint.filter(l => l.lapIndex >= first.lapIndex).length;
  out.set(end.stint, {
    kind: 'flag',
    needed: (startLevel(first, unit) as number) / lapsRun,
    atFlag,
  });
  return out;
}
