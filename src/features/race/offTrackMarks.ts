import type {OffTrackEvent} from '@/src/analysis/offTrackEvents';
import type {Span} from '@/src/analysis/raceLanes';

/** A map marker where a car went off the road. */
export interface OffTrackMark {
  key: string;
  xM: number;
  zM: number;
}

/**
 * The map's off-track markers: every event that starts inside the lanes'
 * window, for your car and, when one is focused, that car too (D52). Events
 * are the car's own, in order; each is one marker at its first update off.
 * Pure: the screen places the world metres through the map's projection.
 */
export function offTrackMarks(
  sets: {carIndex: number; events: OffTrackEvent[]}[],
  window: Span,
): OffTrackMark[] {
  const out: OffTrackMark[] = [];
  for (const {carIndex, events} of sets) {
    for (const e of events) {
      if (e.fromS < window.fromS || e.fromS > window.toS) continue;
      out.push({key: `off-${carIndex}-${e.fromS}`, xM: e.xM, zM: e.zM});
    }
  }
  return out;
}
