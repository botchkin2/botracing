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
