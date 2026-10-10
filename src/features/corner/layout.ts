// What the Corner screen shows and in what order (roadmap M5, D32; standing
// call 2026-10-09: charts first, numbers below, seek controls always visible).

export type CornerBlock = 'charts' | 'shape' | 'laps' | 'spread' | 'nav';

export type CornerLayout = {
  /** Pinned above the scroll: the Compare link and the corner seek chips. */
  pinnedSeek: boolean;
  /** Top to bottom in the scrolling page (phone) or left bar (wide). */
  order: CornerBlock[];
  /** Blocks that start folded: one tap away, not in the first screen. */
  folded: CornerBlock[];
};

/**
 * Phone: charts, the corner shape, the lap table, then the folded spread
 * (strips, section window); nothing is cut, it is just below the first read.
 * Wide: the shape and the table lead the left bar (the charts are the right
 * column), the spread folds under them.
 */
export function cornerLayout(wide: boolean): CornerLayout {
  if (wide)
    return {
      pinnedSeek: false,
      order: ['shape', 'laps', 'spread'],
      folded: ['spread'],
    };
  return {
    pinnedSeek: true,
    order: ['charts', 'shape', 'laps', 'spread', 'nav'],
    folded: ['spread'],
  };
}
