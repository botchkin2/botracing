import {describe, expect, it} from '@jest/globals';

import {rangeOf} from './rangeIndex';

/** The plain scan rangeOf replaces. */
function scan(a: number[], from: number, to: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = Math.max(0, from); i <= Math.min(a.length - 1, to); i++) {
    if (a[i] < lo) lo = a[i];
    if (a[i] > hi) hi = a[i];
  }
  return [lo, hi];
}

describe('rangeOf', () => {
  // A lap's speed on a 5 m grid: 800 values, with a braking spike.
  const a = Array.from({length: 800}, (_, i) => 150 + 60 * Math.sin(i / 40));
  a[417] = 61; // the hairpin's minimum, inside a block

  it('equals the plain scan for every kind of range', () => {
    for (const [from, to] of [
      [0, 799],
      [0, 0],
      [5, 20], // inside one block
      [30, 34], // across one block edge
      [31, 700],
      [400, 450], // the spike
      [-10, 2000], // clamped
      [790, 799],
    ])
      expect(rangeOf(a, from, to)).toEqual(scan(a, from, to));
  });

  it('keeps a single-sample spike', () => {
    expect(rangeOf(a, 0, 799)[0]).toBe(61);
  });

  it('is empty for an empty range, and skips NaN like the scan', () => {
    expect(rangeOf(a, 10, 9)).toEqual([Infinity, -Infinity]);
    const gaps = [NaN, 3, NaN, 7, ...Array.from({length: 100}, () => NaN)];
    expect(rangeOf(gaps, 0, 103)).toEqual([3, 7]);
  });
});
