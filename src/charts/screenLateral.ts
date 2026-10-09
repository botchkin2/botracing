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
