import {fitScale, type Tick} from '@/src/charts/scale';
import {signedSeconds} from '@/src/charts/tickFormat';

// The Whole lap overview's y scale (Theme D, pit-wall thread 1 #4025): the time
// diff on the shared 1-2-5 scale, symmetric about zero, labelled in seconds at
// its two ends. The zero line marks 0 itself, so it carries no label.

// The overview is 58 pt tall: the ends and zero are all a scale that short holds.
const MAX_TICKS = 3;

export function overviewScale(lines: readonly {values: readonly number[]}[]): {
  domain: [number, number];
  ticks: Tick[];
} {
  const values: number[] = [];
  for (const l of lines) for (const v of l.values) values.push(v);
  const s = fitScale(values, {
    symmetric: true,
    maxTicks: MAX_TICKS,
    format: signedSeconds,
  });
  return {domain: [s.lo, s.hi], ticks: s.ticks.filter(t => t.v !== 0)};
}
