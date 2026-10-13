import {describe, expect, it} from '@jest/globals';

import {columnStats, turnRangeLabel} from './segments';

describe('columnStats', () => {
  it('takes the median, best and IQR of exactly the times given', () => {
    expect(columnStats([10, 12, 11, 13])).toEqual({
      n: 4,
      bestS: 10,
      medianS: 11.5,
      spreadS: 1.5,
    });
  });

  it('counts a single time as its own median, with no spread shown', () => {
    expect(columnStats([7.5])).toEqual({
      n: 1,
      bestS: 7.5,
      medianS: 7.5,
      spreadS: null,
    });
  });

  it('skips null and non-finite times, and reads no times as n 0', () => {
    expect(columnStats([null, NaN, 9])).toMatchObject({n: 1, medianS: 9});
    expect(columnStats([null])).toEqual({
      n: 0,
      bestS: null,
      medianS: null,
      spreadS: null,
    });
  });
});

describe('turnRangeLabel', () => {
  it('names one corner, a range, and official names', () => {
    expect(turnRangeLabel(['T4'])).toBe('T4');
    expect(turnRangeLabel(['T2', 'T3', 'T5'])).toBe('T2–5');
    expect(turnRangeLabel(['T10a', 'T10b'])).toBe('T10a–T10b');
    expect(turnRangeLabel([])).toBe('');
  });
});
