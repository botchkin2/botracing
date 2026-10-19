import {describe, expect, it} from '@jest/globals';

import {ranksOf, spearman, spearmanCritical} from './rankCorrelation';

describe('ranksOf', () => {
  it('ranks from 1 and shares the mean rank between equal values', () => {
    expect(ranksOf([30, 10, 20])).toEqual([3, 1, 2]);
    expect(ranksOf([5, 5, 1, 9])).toEqual([2.5, 2.5, 1, 4]);
  });
});

describe('spearman', () => {
  it('is 1 for the same order, -1 for the reverse, whatever the scale', () => {
    expect(spearman([1, 2, 3, 4], [10, 200, 3000, 40000])?.rho).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])?.rho).toBeCloseTo(-1);
  });

  it('matches a worked example with a tie', () => {
    // ranks x 1 2 3 4 5, y 2 1 4.5 4.5 3: covariance 5.5 over sqrt(10 * 9.5) = 0.5643
    const r = spearman([1, 2, 3, 4, 5], [20, 10, 40, 40, 30]);
    expect(r?.n).toBe(5);
    expect(r?.rho).toBeCloseTo(0.5643, 3);
  });

  it('skips pairs with a missing value and says how many it used', () => {
    const r = spearman([1, null, 3, 4, 5], [1, 2, 3, null, 5]);
    expect(r?.n).toBe(3);
    expect(r?.rho).toBeCloseTo(1);
  });

  it('is null under 3 pairs and when a side never varies', () => {
    expect(spearman([1, 2], [1, 2])).toBeNull();
    expect(spearman([1, 2, 3, 4], [7, 7, 7, 7])).toBeNull();
  });
});

describe('spearmanCritical', () => {
  it('is the exact two-sided 5 % table: 13 laps 0.56, 20 laps 0.447', () => {
    expect(spearmanCritical(13)).toBe(0.56);
    expect(spearmanCritical(20)).toBe(0.447);
    expect(spearmanCritical(10)).toBe(0.648);
  });

  it('continues the table by the t approximation past 30, falling with n', () => {
    const c31 = spearmanCritical(31) as number;
    expect(c31).toBeGreaterThan(0.34);
    expect(c31).toBeLessThan(0.362);
    expect(spearmanCritical(100) as number).toBeCloseTo(0.197, 2);
    expect(spearmanCritical(100) as number).toBeLessThan(c31);
  });

  it('has no value under 10 laps', () => {
    expect(spearmanCritical(9)).toBeNull();
  });
});
