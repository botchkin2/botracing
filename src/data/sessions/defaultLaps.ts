import {type RefLap, rankReferenceLaps} from '@/src/analysis/referenceLap';

import type {Lap} from './adapters';

/**
 * The laps a screen opens on when the URL names none: the best lap as
 * reference (else the fastest comparable lap) plus the fastest other
 * comparable lap, so a screen never waits on an empty list. Compare and
 * Corner share it.
 */
export function defaultLapIds(laps: Lap[], bestLapId: string | null): string[] {
  const comparable = laps.filter(l => l.comparable && l.timeS != null);
  const ref =
    bestLapId && laps.some(l => l.id === bestLapId)
      ? bestLapId
      : comparable.slice().sort((a, b) => a.timeS! - b.timeS!)[0]?.id;
  if (!ref) return [];
  const second = comparable
    .filter(l => l.id !== ref)
    .sort((a, b) => a.timeS! - b.timeS!)[0];
  return second ? [ref, second.id] : [ref];
}

/** What the session says about its laps: enough to tell a fair reference from a lucky one. */
export type DefaultSession = {
  id: string;
  bestLapId: string | null;
  /** The car as the session names it; every lap of a session shares it. */
  car: string;
  sessionType: string;
};

/** The ranking's view of a lap (analysis/referenceLap.ts). */
export function refLapOf(
  lap: Lap,
  session: Pick<DefaultSession, 'id' | 'car' | 'sessionType'>,
): RefLap {
  return {
    id: lap.id,
    sessionId: session.id,
    car: session.car,
    sessionType: session.sessionType,
    timeS: lap.timeS,
    comparable: lap.comparable,
    partial: lap.partial,
    pitIn: lap.pitIn,
    pitOut: lap.pitOut,
    endedInReset: lap.endedInReset,
    hadImpact: lap.hadImpact,
    offTrackS: lap.offTrackS,
    newTyres: lap.newTyres,
    startL: lap.fuel?.startL ?? null,
    veStartPct: lap.fuel?.veStartPct ?? null,
  };
}

/**
 * The laps Compare opens on when the URL names none: the session's median
 * comparable lap, and as its reference the fairest other lap for it (same
 * fuel band, tyres kept, on track; then the fastest). A best lap on low fuel
 * is the wrong ruler for a race lap, so this replaces "best lap first".
 * With fewer than three comparable laps, or no fair reference, it is
 * `defaultLapIds`.
 */
export function referenceDefaultLapIds(
  laps: Lap[],
  session: DefaultSession,
): string[] {
  const timed = laps
    .filter(l => l.comparable && l.timeS != null)
    .sort((a, b) => (a.timeS ?? 0) - (b.timeS ?? 0));
  if (timed.length < 3) return defaultLapIds(laps, session.bestLapId);
  const target = timed[Math.floor((timed.length - 1) / 2)];
  const ranked = rankReferenceLaps(
    refLapOf(target, session),
    timed.map(l => refLapOf(l, session)),
  );
  return ranked.length > 0
    ? [ranked[0].lapId, target.id]
    : defaultLapIds(laps, session.bestLapId);
}
