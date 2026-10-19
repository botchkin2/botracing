// What the Corner screen shows and in what order (roadmap M5, D32; standing
// call 2026-10-09: charts first, numbers below, seek controls always visible).

export type CornerBlock =
  | 'moves'
  | 'charts'
  | 'shape'
  | 'laps'
  | 'strips'
  | 'spread'
  | 'nav';

export type CornerLayout = {
  /** Pinned above the scroll: the Compare link and the corner seek chips. */
  pinnedSeek: boolean;
  /** Top to bottom in the scrolling page (phone) or left bar (wide). */
  order: CornerBlock[];
  /** Blocks that start folded: one tap away, not in the first screen. */
  folded: CornerBlock[];
};

/**
 * What moves with the time leads the cards (Corner's first one, thread 88
 * S4): on the phone right under the charts, on the wide left bar first.
 * Phone: charts, the card, the corner shape, the lap table, the dot strips (always
 * shown), then the folded spread (the section window); nothing is cut, it is
 * just below the first read. Wide: the shape and the table lead the left bar
 * (the charts are the right column), the strips under them, the spread folds
 * last.
 */
export function cornerLayout(wide: boolean): CornerLayout {
  if (wide)
    return {
      pinnedSeek: false,
      order: ['moves', 'shape', 'laps', 'strips', 'spread'],
      folded: ['spread'],
    };
  return {
    pinnedSeek: true,
    order: ['charts', 'moves', 'shape', 'laps', 'strips', 'spread', 'nav'],
    folded: ['spread'],
  };
}
