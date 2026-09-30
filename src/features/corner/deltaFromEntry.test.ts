import {describe, expect, it} from '@jest/globals';

import {type GridTrace} from '@/src/analysis/resample';

import {deltaFromEntry} from './deltaFromEntry';

// A grid of 11 points, 5 m apart; only distance and time matter here.
function trace(timeS: number[]): GridTrace {
  return {
    stepM: 5,
    distanceM: timeS.map((_, i) => i * 5),
    timeS,
  } as unknown as GridTrace;
}

describe('deltaFromEntry', () => {
  const ref = trace([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // 0.4 s behind at 20 m, then gains 0.1 s over each of the next 10 m.
  const lap = trace([0.1, 1.2, 2.3, 3.4, 4.4, 5.35, 6.3, 7.3, 8.3, 9.3, 10.3]);

  it('is zero at the entry and counts only what happens after it', () => {
    const d = deltaFromEntry(lap, ref, 20);
    expect(d[4]).toBeCloseTo(0, 9);
    expect(d[6]).toBeCloseTo(0.3 - 0.4, 9);
    // Before the entry it is the gap relative to the entry's gap.
    expect(d[0]).toBeCloseTo(0.1 - 0.4, 9);
  });

  it('the reference against itself is flat zero', () => {
    expect(deltaFromEntry(ref, ref, 20).every(v => v === 0)).toBe(true);
  });

  it('an entry before the start of the lap uses the first point', () => {
    const d = deltaFromEntry(lap, ref, -60);
    expect(d[0]).toBe(0);
  });

  it('is empty without both traces', () => {
    expect(deltaFromEntry(undefined, ref, 20)).toEqual([]);
    expect(deltaFromEntry(lap, undefined, 20)).toEqual([]);
  });
});
