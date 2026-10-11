// The inside-the-box rule for chart text (pit-wall thread 1, bias #4194): every
// chart svg clips at its edges, so a tick label, tag or legend is placed by its
// text box and held inside the svg. Pure, so a test proves the box for any text.

// IBM Plex Mono's metrics (the axis font): an advance of 0.6 em per glyph, and
// the box Chrome draws for 9 pt text: 9.33 above the baseline and 2.67 below
// (getBBox on the live Laps chart; the font's own 1.025 / 0.275, pixel-rounded).
export const ASCENT_EM = 1.04;
export const DESCENT_EM = 0.3;
export const CHAR_EM = 0.6;
// The box is kept this far inside the frame: a glyph's ink can overhang its
// advance by 0.6 px ("TOW" measures 16.8 against a 16.2 advance).
export const EDGE_PT = 1;

export type Anchor = 'start' | 'middle' | 'end';

export type Box = {left: number; right: number; top: number; bottom: number};

/** The text box of a label drawn at (x, baseline). */
export function labelBox(
  text: string,
  x: number,
  baseline: number,
  fontSize: number,
  anchor: Anchor,
): Box {
  const w = [...text].length * CHAR_EM * fontSize;
  const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return {
    left,
    right: left + w,
    top: baseline - ASCENT_EM * fontSize,
    bottom: baseline + DESCENT_EM * fontSize,
  };
}

/**
 * Where a label is drawn so its box sits inside a width × height frame, EDGE_PT
 * in from each edge: moved only by the amount it would cross an edge. A label
 * wider or taller than the frame keeps its start edge (left, top) inside.
 */
export function insideFrame(
  text: string,
  x: number,
  baseline: number,
  fontSize: number,
  anchor: Anchor,
  frame: {width: number; height: number},
): {x: number; baseline: number} {
  const b = labelBox(text, x, baseline, fontSize, anchor);
  return {
    x: x + shift(b.left, b.right, frame.width),
    baseline: baseline + shift(b.top, b.bottom, frame.height),
  };
}

/** How far to move [lo, hi] to sit inside [EDGE_PT, size − EDGE_PT]. */
function shift(lo: number, hi: number, size: number): number {
  const min = EDGE_PT;
  const max = size - EDGE_PT;
  const d = lo < min ? min - lo : hi > max ? max - hi : 0;
  // Too big to fit: the start edge wins.
  return lo + d < min ? min - lo : d;
}
