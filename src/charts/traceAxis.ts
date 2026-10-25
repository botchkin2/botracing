// Where TraceChart's text goes, from the label box (labelBox.ts): the plot is
// padded so a y tick centred on its value fits, tags hang under or stand over
// their lines, and an x tick that would run past the right edge is dropped.
// Pure, so a test proves no tick needs moving at any chart height.

import {
  ASCENT_EM,
  baselineOver,
  baselineUnder,
  centredBaseline,
  DESCENT_EM,
  EDGE_PT,
  thinLabels,
  labelBox,
  textWidth,
  tickPad,
} from './labelBox';
import {shortSectionName} from '@/src/analysis/turnNames';

/** The y range is drawn this far in from the plot's top and bottom without y ticks. */
export const Y_PAD = 3;
/** The distance axis under the plot. */
export const AXIS_H = 12;

/** The plot's top and bottom pad: room for a centred y tick when there are any. */
export function plotPad(hasYTicks: boolean, fontSize: number): number {
  return hasYTicks ? Math.max(Y_PAD, tickPad(fontSize)) : Y_PAD;
}

/** Plot y of a value over a y range, inside `pad` at the top and bottom. */
export function yOfValue(
  [lo, hi]: [number, number],
  height: number,
  pad: number,
  v: number,
): number {
  return pad + (1 - (v - lo) / (hi - lo || 1)) * (height - 2 * pad);
}

/** Plot y of a value is a + b·v for a y range: its offset and scale. */
export function yLine(
  [lo, hi]: [number, number],
  height: number,
  pad: number,
): [number, number] {
  const b = -(height - 2 * pad) / (hi - lo || 1);
  return [pad - b * hi, b];
}

/** A y tick's baseline: its box centred on its value's line. */
export const yTickBaseline = centredBaseline;

/**
 * A series' own tick (the stacked steering band, whose range is stretched past
 * its ticks): the top tick hangs under its band's top line, the bottom one
 * stands on its bottom line, the rest centre on theirs.
 */
export function seriesTickBaseline(
  at: number,
  place: 'top' | 'bottom' | 'mid',
  fontSize: number,
): number {
  if (place === 'top') return baselineUnder(at, fontSize);
  if (place === 'bottom') return baselineOver(at, fontSize);
  return centredBaseline(at, fontSize);
}

/** An x tick's baseline: standing on the svg's bottom edge, under the plot. */
export function xTickBaseline(plotHeight: number, fontSize: number): number {
  return baselineOver(plotHeight + AXIS_H, fontSize);
}

/** A mark's label (apex, sector) hangs under the plot's top edge. */
export function markBaseline(fontSize: number): number {
  return baselineUnder(0, fontSize);
}

/** A section's start on the lap: where its tick stands and what it is called. */
export interface SectionTick {
  m: number;
  /** The section's name as every screen writes it ("T2–4"). */
  label: string;
}

/**
 * The labels under a lap-wide plot at each section's start: the name as
 * written where it fits before the next section's tick, else the shortest name
 * (`shortSectionName`), else none (the line stays). `xOf` is the chart's one
 * distance-to-x mapping, so a time window and a distance window label alike.
 */
export function sectionTickLabels(
  ticks: readonly SectionTick[],
  xOf: (m: number) => number,
  width: number,
  fontSize: number,
): {x: number; text: string}[] {
  const at = ticks
    .map(t => ({label: t.label, x: xOf(t.m)}))
    .filter(t => t.x >= 0 && t.x < width)
    .sort((a, b) => a.x - b.x);
  const out: {x: number; text: string}[] = [];
  at.forEach((t, i) => {
    const room = (i + 1 < at.length ? at[i + 1].x : width - EDGE_PT) - t.x - 2;
    const text = [t.label, shortSectionName(t.label)].find(
      s =>
        textWidth(s, fontSize) <= room &&
        fitsRight(s, t.x + 2, width, fontSize),
    );
    if (text) out.push({x: t.x, text});
  });
  return out;
}

/** True when a start-anchored label at x fits before the right edge. */
export function fitsRight(
  text: string,
  x: number,
  width: number,
  fontSize: number,
): boolean {
  return labelBox(text, x, 0, fontSize, 'start').right <= width - EDGE_PT;
}

/**
 * The y ticks that get a label: every k-th, with the smallest k whose labels'
 * boxes do not overlap and that keeps both ends (a short pedal chart shows 0,
 * 50, 100 %; a short steering chart −100, 0, 100 %). Two ends always fit:
 * they are the scale's extremes. The ticks are in value order, evenly spaced.
 */
export function labelledTicks<T extends {v: number}>(
  ticks: readonly T[],
  y: (v: number) => number,
  fontSize: number,
): T[] {
  return thinLabels(ticks, y, (ASCENT_EM + DESCENT_EM) * fontSize);
}
