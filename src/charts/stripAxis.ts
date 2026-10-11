// The dot strip's x axis (D45): where each value sits, which ticks are
// labelled, and how far the plot keeps from the edges so the end labels fit
// inside the svg (labelBox.ts, the inside-the-box rule). Pure.
import {CHAR_EM, EDGE_PT} from './labelBox';
import {type Scale} from './scale';

/** Room between two neighbouring tick labels, in points. */
export const LABEL_GAP_PT = 6;
/** The plot never comes closer to an edge than this (the dots' radius). */
export const MIN_PAD_PT = 8;

export type StripAxis = {
  /** Plot inset from each side: half the widest tick label, or MIN_PAD_PT. */
  padX: number;
  /** A value's x in the svg. */
  x: (v: number) => number;
  /** Every tick, with its x; `labelled` ticks also draw their text. */
  ticks: {v: number; x: number; label: string; labelled: boolean}[];
};

const textWidth = (text: string, fontSize: number) =>
  [...text].length * CHAR_EM * fontSize;

/**
 * The axis for a strip `width` wide on `scale`. With `flipped` the larger
 * values are on the left (brake point: earlier on the lap). Labels that would
 * touch their neighbour are thinned to every k-th tick, counting from the low
 * end, so the step stays regular.
 */
export function stripAxis(
  scale: Scale,
  width: number,
  flipped: boolean,
  fontSize: number,
): StripAxis {
  const widest = Math.max(
    0,
    ...scale.ticks.map(t => textWidth(t.label, fontSize)),
  );
  const padX = Math.max(MIN_PAD_PT, widest / 2 + EDGE_PT);
  const span = scale.hi - scale.lo || 1;
  const plotW = Math.max(1, width - 2 * padX);
  const x = (v: number) => {
    const f = (v - scale.lo) / span;
    return padX + (flipped ? 1 - f : f) * plotW;
  };
  const n = scale.ticks.length;
  const spacing = n > 1 ? plotW / (n - 1) : plotW;
  let k = Math.max(1, Math.ceil((widest + LABEL_GAP_PT) / (spacing || 1)));
  // Keep the step regular and the far end labelled where it divides evenly.
  while (k < n - 1 && (n - 1) % k !== 0) k++;
  return {
    padX,
    x,
    ticks: scale.ticks.map((t, i) => ({
      v: t.v,
      x: x(t.v),
      label: t.label,
      labelled: i % k === 0,
    })),
  };
}
