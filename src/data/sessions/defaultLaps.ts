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

/** The session as the default-lap rules read it: built from one detail, in one place. */
export function defaultSessionOf(s: {
  id: string;
  bestLapId: string | null;
  car: string;
  sessionType: string;
}): DefaultSession {
  return {
    id: s.id,
    bestLapId: s.bestLapId,
    car: s.car,
    sessionType: s.sessionType,
  };
}

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

/**
 * The laps Compare opens on when the URL names none: every comparable lap of
 * one stint, so the screen is a set of laps against their median, never a
 * pair (apex, pit-wall thread 1 #3229). The stint is the one with the most
 * comparable laps, the later one on a tie: the run that was the session's
 * racing pace. A session of one stint is all its comparable laps. Under two
 * comparable laps there is no set: the caller falls back to a pair.
 */
export function stintSetLapIds(laps: Lap[]): string[] {
  const byStint = new Map<number, Lap[]>();
  for (const l of laps) {
    if (!l.comparable || l.timeS == null) continue;
    byStint.set(l.stint, [...(byStint.get(l.stint) ?? []), l]);
  }
  let best: Lap[] = [];
  let bestStint = -Infinity;
  for (const [stint, list] of byStint) {
    if (
      list.length > best.length ||
      (list.length === best.length && stint > bestStint)
    ) {
      best = list;
      bestStint = stint;
    }
  }
  return best.length >= 2 ? best.map(l => l.id) : [];
}

/**
 * The laps a session screen opens on when the URL names none: the stint set,
 * else the reference pair. Compare and the session grid both read this, so
 * they never disagree about what is selected.
 */
export function openingLapIds(laps: Lap[], session: DefaultSession): string[] {
  const set = stintSetLapIds(laps);
  return set.length > 0 ? set : referenceDefaultLapIds(laps, session);
}
