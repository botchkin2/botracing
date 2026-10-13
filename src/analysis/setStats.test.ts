import {describe, expect, it} from '@jest/globals';

import {
  iqr,
  median,
  MIN_SPREAD_N,
  percentile,
  quantile,
  sortedFinite,
} from './setStats';

describe('setStats', () => {
  it('sorts the finite values and skips the rest', () => {
    expect(sortedFinite([3, null, 1, undefined, NaN, Infinity, 2])).toEqual([
      1, 2, 3,
    ]);
  });

  it('takes the middle of an odd set and the mean of the middle two of an even set', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('is null with no value and never reads a missing value as 0', () => {
    expect(median([])).toBeNull();
    expect(median([null, NaN])).toBeNull();
    expect(median([null, 10, 20])).toBe(15);
    expect(percentile([], 0.9)).toBeNull();
    expect(quantile([], 0.5)).toBeNaN();
  });

  it('interpolates a quantile between the neighbours', () => {
    expect(quantile([0, 10], 0.25)).toBe(2.5);
    expect(percentile([10, 0, 20, 30], 0.9)).toBeCloseTo(27);
  });

  it('is the IQR (p75 - p25), and empty under the minimum count', () => {
    expect(iqr([10, 12, 11, 13])).toBe(1.5);
    expect(iqr([7.5])).toBeNull();
    expect(iqr([null, 7.5])).toBeNull();
    expect(MIN_SPREAD_N).toBe(2);
    expect(iqr([1, 2])).toBe(0.5);
  });
});
