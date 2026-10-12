// The dot strip's x axis (D45): where each value sits, which ticks are
// labelled, and how far the plot keeps from the edges so the end labels fit
// inside the svg (labelBox.ts, the inside-the-box rule). Pure.
import {EDGE_PT, textWidth, thinLabels} from './labelBox';
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

/**
 * The axis for a strip `width` wide on `scale`. With `flipped` the larger
 * values are on the left (brake point: earlier on the lap). Labels that would
 * touch their neighbour are thinned to every k-th tick, keeping both ends
 * (labelBox.thinLabels).
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
  // Both ends keep their labels; the rest thin to every k-th tick
  // (labelBox.thinLabels, the same rule as the trace charts' y ticks).
  const labelled = new Set(
    thinLabels(scale.ticks, x, widest + LABEL_GAP_PT).map(t => t.v),
  );
  return {
    padX,
    x,
    ticks: scale.ticks.map(t => ({
      v: t.v,
      x: x(t.v),
      label: t.label,
      labelled: labelled.has(t.v),
    })),
  };
}
