// The inside-the-box rule for chart text (pit-wall thread 1, bias #4194): every
// chart svg clips at its edges, so a chart pads its plot by its labels' boxes
// and places each label from its box: a tick centred on its line, a tag sitting
// on an edge. Nothing is nudged; insideFrame is the safety net that ChartLabel
// warns on. Pure, so tests prove the boxes.
//
// The metrics are the axis font's (IBM Plex Mono): ChartLabel draws only in it.

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

/** A label's advance width in the axis font: one CHAR_EM per glyph. */
export function textWidth(text: string, fontSize: number): number {
  return [...text].length * CHAR_EM * fontSize;
}

/** The text box of a label drawn at (x, baseline). */
export function labelBox(
  text: string,
  x: number,
  baseline: number,
  fontSize: number,
  anchor: Anchor,
): Box {
  const w = textWidth(text, fontSize);
  const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return {
    left,
    right: left + w,
    top: baseline - ASCENT_EM * fontSize,
    bottom: baseline + DESCENT_EM * fontSize,
  };
}

/** The baseline that centres a label's box on a line at y (a tick on its gridline). */
export function centredBaseline(y: number, fontSize: number): number {
  return y + ((ASCENT_EM - DESCENT_EM) / 2) * fontSize;
}

/** The baseline of a label hanging just under a line at y (EDGE_PT below it). */
export function baselineUnder(y: number, fontSize: number): number {
  return y + EDGE_PT + ASCENT_EM * fontSize;
}

/** The baseline of a label standing just over a line at y (EDGE_PT above it). */
export function baselineOver(y: number, fontSize: number): number {
  return y - EDGE_PT - DESCENT_EM * fontSize;
}

/**
 * How far a plot keeps its value range from the svg's top and bottom so a tick
 * centred on the range's end still fits: half the label box, plus EDGE_PT.
 */
export function tickPad(fontSize: number): number {
  return EDGE_PT + ((ASCENT_EM + DESCENT_EM) / 2) * fontSize;
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

/**
 * The evenly spaced ticks that get a label, on either axis: every k-th, with
 * the smallest k whose labels (each `extent` long along the axis) do not touch
 * and that keeps both ends. Two ends always fit: they are the scale's
 * extremes. `pos` places a tick's value on the axis.
 */
export function thinLabels<T extends {v: number}>(
  ticks: readonly T[],
  pos: (v: number) => number,
  extent: number,
): T[] {
  const last = ticks.length - 1;
  if (last < 1) return [...ticks];
  const gap = Math.abs(pos(ticks[1].v) - pos(ticks[0].v));
  let k = Math.max(1, Math.ceil(extent / (gap || 1)));
  while (k < last && last % k !== 0) k++;
  return ticks.filter((_, i) => i % Math.min(k, last) === 0);
}
