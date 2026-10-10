// Where the lap-time chart's STINT, PIT and RESET labels go. Pure, so a test can
// prove that no two labels' boxes overlap, at any width.

// A text row is 11 pt tall (a 9 pt mono line box); the pitch is a point more,
// so two rows never touch.
export const LABEL_ROW = 12;
// Mono 9 pt glyphs are 0.6 em, 5.4 pt wide; the browser measures 5.45. A little
// over, so a label is never estimated narrower than it draws.
export const LABEL_CHAR_W = 5.6;
const GAP = 4;
// Where the first row's text sits.
export const LABEL_TOP = 9;

export type TopLabel = {key: string; x: number; text: string; color: string};
export type PlacedLabel = TopLabel & {row: number; anchor: 'start' | 'end'};

/**
 * Left to right, each label takes the first row where it clears the last one
 * in that row by GAP. One that would run past maxX is drawn right-aligned,
 * ending at its line.
 */
export function placeTopLabels(
  labels: TopLabel[],
  maxX: number,
): PlacedLabel[] {
  const rowEnds: number[] = [];
  return [...labels]
    .sort((a, b) => a.x - b.x)
    .map(l => {
      const w = l.text.length * LABEL_CHAR_W;
      const flip = l.x + w > maxX;
      const left = flip ? l.x - 6 - w : l.x;
      let row = rowEnds.findIndex(end => end + GAP <= left);
      if (row < 0) row = rowEnds.length;
      rowEnds[row] = left + w;
      return {
        ...l,
        x: flip ? l.x - 6 : l.x,
        row,
        anchor: flip ? 'end' : 'start',
      };
    });
}

/** The y of a row's text baseline. */
export const labelY = (row: number): number => LABEL_TOP + row * LABEL_ROW;

/** How far down the rows reach: the plot starts below the last row's text. */
export function labelsBottom(placed: PlacedLabel[]): number {
  const rows = placed.reduce((m, l) => Math.max(m, l.row + 1), 0);
  return rows === 0 ? 0 : labelY(rows - 1) + 3;
}
