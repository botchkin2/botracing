import {describe, expect, it} from '@jest/globals';

import {type StintOptimum} from '@/src/analysis/sectionOptimum';

import {optimumFacts} from './optimumFacts';

const section = {bestS: 1, bestLapId: 'a', medianS: 1, n: 9};
const stint = (over: Partial<StintOptimum> = {}): StintOptimum => ({
  stint: 2,
  lapCount: 9,
  windows: [section, section],
  bestSumS: 108.62,
  medianSumS: 110.1,
  ...over,
});

describe('optimumFacts', () => {
  it('is empty before the sections', () => {
    expect(optimumFacts([], 2, 1)).toEqual([]);
  });

  it('names the optimal lap with the laps and sections behind it', () => {
    expect(optimumFacts([stint()], 2, 1)).toEqual([
      {label: 'Optimal lap', value: '1:48.620 · 9 laps, 2 sections'},
    ]);
  });

  it('adds the stint when the session has more than one', () => {
    expect(optimumFacts([stint()], 2, 3)[0].label).toBe(
      'Optimal lap · stint 2',
    );
  });

  it('shows nothing for a stint with a section under the floor', () => {
    expect(optimumFacts([stint({bestSumS: null})], 2, 1)).toEqual([]);
  });
});
