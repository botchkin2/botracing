import {describe, expect, it} from '@jest/globals';

import {type OptimumLap, sectionOptimum} from './sectionOptimum';

const lap = (
  id: string,
  stint: number,
  windowsS: (number | null)[],
): OptimumLap => ({id, stint, windowsS});

// Five laps, two windows: window 0 times 10..14, window 1 times 20..24.
const five = [0, 1, 2, 3, 4].map(i => lap(`l${i}`, 1, [10 + i, 20 + i]));

describe('sectionOptimum', () => {
  it('sums each window best and each window median, with n', () => {
    const [s] = sectionOptimum(five, 2);
    expect(s.stint).toBe(1);
    expect(s.lapCount).toBe(5);
    expect(s.windows).toEqual([
      {n: 5, bestS: 10, bestLapId: 'l0', medianS: 12},
      {n: 5, bestS: 20, bestLapId: 'l0', medianS: 22},
    ]);
    expect(s.bestSumS).toBe(30);
    expect(s.medianSumS).toBe(34);
  });

  it('takes the best from different laps and the median of an even count', () => {
    const laps = [
      lap('a', 1, [10, 25]),
      lap('b', 1, [12, 20]),
      lap('c', 1, [11, 22]),
      lap('d', 1, [13, 21]),
      lap('e', 1, [14, 23]),
      lap('f', 1, [15, 24]),
    ];
    const [s] = sectionOptimum(laps, 2);
    expect(s.windows[0]).toEqual({n: 6, bestS: 10, bestLapId: 'a', medianS: 12.5});
    expect(s.windows[1]).toEqual({n: 6, bestS: 20, bestLapId: 'b', medianS: 22.5});
    expect(s.bestSumS).toBe(30);
    expect(s.medianSumS).toBe(35);
  });

  it('leaves out a stint under 5 laps', () => {
    expect(sectionOptimum(five.slice(0, 4), 2)).toEqual([]);
  });

  it('keeps stints apart', () => {
    const stint2 = five.map(l => lap(`s2${l.id}`, 2, [1, 2]));
    const out = sectionOptimum([...stint2, ...five], 2);
    expect(out.map(s => s.stint)).toEqual([1, 2]);
    expect(out[0].bestSumS).toBe(30);
    expect(out[1].bestSumS).toBe(3);
  });

  it('counts only the windows that count: a null time is not a time', () => {
    // Window 0 is out for two laps, so n is 3 and it has no best.
    const laps = five.map((l, i) =>
      i < 2 ? lap(l.id, 1, [null, l.windowsS[1]]) : l,
    );
    const [s] = sectionOptimum(laps, 2);
    expect(s.windows[0]).toEqual({
      n: 3,
      bestS: null,
      bestLapId: null,
      medianS: null,
    });
    expect(s.windows[1].n).toBe(5);
    // A sum with a hole is not a lap.
    expect(s.bestSumS).toBeNull();
    expect(s.medianSumS).toBeNull();
  });

  it('is empty without laps or windows', () => {
    expect(sectionOptimum([], 2)).toEqual([]);
    const [s] = sectionOptimum(five, 0);
    expect(s.bestSumS).toBeNull();
  });
});
