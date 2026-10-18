import type {Lap} from '@/src/data/sessions';
import {oneDecimal} from '@/src/design';

import type {LapRef} from './model';

/**
 * The game's track-limit strikes on the Compare map (pit-wall thread 70, plank
 * #5648): one mark where the car went furthest past the edge, for each
 * selected lap's strikes that were placed on the lap (`atM`). A tap reads
 * the lap, how far past the line, and the game's own words for the ruling.
 */
export type StrikeMark = LapRef & {
  key: string;
  at: {x: number; y: number};
  widthM: number | null;
  ruling: string;
};

export function strikeMarksOf(
  refs: LapRef[],
  lapOf: (lapId: string) => Lap | undefined,
  /** The map point of a lap at a distance; null when the lap has no trace. */
  pointAt: (lapId: string, m: number) => {x: number; y: number} | null,
): StrikeMark[] {
  return refs.flatMap(ref =>
    (lapOf(ref.lapId)?.trackLimits ?? []).flatMap((s, i) => {
      if (s.atM == null) return [];
      const at = pointAt(ref.lapId, s.atM);
      return at
        ? [
            {
              ...ref,
              key: `${ref.lapId}:${i}`,
              at,
              widthM: s.widthM,
              ruling: s.ruling,
            },
          ]
        : [];
    }),
  );
}

/** "L7 · 0.4 m past the edge · No Further Action". */
export function strikeText(m: Pick<StrikeMark, 'label' | 'widthM' | 'ruling'>) {
  return [
    m.label,
    m.widthM != null ? `${oneDecimal(m.widthM)} m past the edge` : null,
    m.ruling || null,
  ]
    .filter(Boolean)
    .join(' · ');
}
