import {type NativeSamples} from '@/src/analysis/nativeSamples';

// Lateral and steering values are recorded +right (LMU: steering runs left to
// right, InternalsPlugin.hpp). A chart runs distance left to right, so a
// reader sees it like a map from above, where the car's right is down the
// page: the screen draws right DOWN, and the data stays as recorded. Every
// chart that plots a lateral value goes through this one helper.
export const toScreenLateral = (v: number): number => 0 - v;

export function screenLateral(s: NativeSamples): NativeSamples {
  return {distanceM: s.distanceM, values: s.values.map(toScreenLateral)};
}

// A chart draws a line from the array it is given and caches the built path
// under that array's identity (charts/chunkPaths.ts). A flip made on every
// render is a new array every time, so every steering and lateral line was
// rebuilt on every playback frame (10.7 of 23.7 ms in the 19-lap pedals
// chart). These return the same flipped array for the same source.
const flippedSamples = new WeakMap<NativeSamples, NativeSamples>();
const flippedValues = new WeakMap<number[], number[]>();

/** screenLateral, once per source: the same result object for the same samples. */
export function screenLateralOnce(s: NativeSamples): NativeSamples {
  let out = flippedSamples.get(s);
  if (!out) flippedSamples.set(s, (out = screenLateral(s)));
  return out;
}

/** The values flipped, once per source array. */
export function screenValuesOnce(values: number[]): number[] {
  let out = flippedValues.get(values);
  if (!out) flippedValues.set(values, (out = values.map(toScreenLateral)));
  return out;
}

/**
 * A lateral value as a reader sees it: the size, then the side it points to
 * (R for +right, L for −right), so the text agrees with the chart's drawing.
 * Zero to the printed precision has no side.
 */
export function lateralText(v: number, digits: number, unit = ''): string {
  const size = Math.abs(v).toFixed(digits);
  const body = unit ? `${size} ${unit}` : size;
  if (Number(size) === 0) return body;
  return `${body} ${v > 0 ? 'R' : 'L'}`;
}
