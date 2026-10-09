import {describe, expect, it} from '@jest/globals';

import {type StintOptimum} from '@/src/analysis/sectionOptimum';

import {optimumFacts} from './optimumFacts';

const sector = {bestS: 1, bestLapId: 'a', medianS: 1, n: 9};
const stint = (over: Partial<StintOptimum> = {}): StintOptimum => ({
  stint: 2,
  lapCount: 9,
  windows: [sector, sector],
  bestSumS: 108.62,
  medianSumS: 109.9,
  ...over,
});

describe('optimumFacts', () => {
  it('is empty before the sectors', () => {
    expect(optimumFacts([], 2, 1)).toEqual([]);
  });

  it('names the optimal lap, the typical lap and the gap between them with the laps behind them', () => {
    expect(optimumFacts([stint()], 2, 1)).toEqual([
      {label: 'Optimal lap', value: '1:48.620 · 9 laps, 2 sectors'},
      {label: 'Typical lap', value: '1:49.900 · 9 laps'},
      {label: 'Inconsistency', value: '+1.280 s · 9 laps'},
    ]);
  });

  it('adds the stint when the session has more than one', () => {
    expect(optimumFacts([stint()], 2, 3).map(f => f.label)).toEqual([
      'Optimal lap · stint 2',
      'Typical lap · stint 2',
      'Inconsistency · stint 2',
    ]);
  });

  it('shows nothing for a stint with a sector under the floor', () => {
    expect(optimumFacts([stint({bestSumS: null})], 2, 1)).toEqual([]);
  });
});
