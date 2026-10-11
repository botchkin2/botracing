import {describe, expect, it} from '@jest/globals';

import {optimumFacts} from './optimumFacts';
import type {StintNumbers} from './selectionStats';

const stint = (over: Partial<StintNumbers> = {}): StintNumbers => ({
  stint: 2,
  n: 9,
  lapTimes: {n: 9, bestS: 108.9, medianS: 109.9, spreadS: 0.4},
  optimalS: 108.62,
  inconsistencyS: 1.28,
  ...over,
});

describe('optimumFacts', () => {
  it('is empty before the segments', () => {
    expect(optimumFacts([], 1)).toEqual([]);
  });

  it('names Optimal, Median and Inconsistency, each of the laps behind it', () => {
    expect(optimumFacts([stint()], 1)).toEqual([
      {label: 'Optimal', value: '1:48.620 · of 9'},
      {label: 'Median', value: '1:49.900 · of 9'},
      {label: 'Inconsistency', value: '+1.280 s · of 9'},
    ]);
  });

  it('adds the stint when the session has more than one', () => {
    expect(optimumFacts([stint()], 3).map(f => f.label)).toEqual([
      'Optimal · stint 2',
      'Median · stint 2',
      'Inconsistency · stint 2',
    ]);
  });

  it('shows nothing for a stint without an Optimal', () => {
    expect(
      optimumFacts([stint({optimalS: null, inconsistencyS: null})], 1),
    ).toEqual([]);
  });
});
