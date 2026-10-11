import {describe, expect, it} from '@jest/globals';

import {type StintOptimum} from '@/src/analysis/sectionOptimum';

import {optimumLines} from './optimumLines';

const stint = (over: Partial<StintOptimum> = {}): StintOptimum => ({
  stint: 1,
  lapCount: 9,
  windows: [],
  bestSumS: 108.62,
  medianSumS: 109.4,
  ...over,
});

describe('optimumLines', () => {
  it('is one line per stint: optimal, median and the gap, over its laps', () => {
    expect(optimumLines([stint()], 1)).toEqual([
      {
        label: null,
        optimal: '1:48.620',
        median: '1:49.400',
        inconsistency: '+0.780 s',
        laps: '9 laps',
      },
    ]);
  });

  it('names the stint only when there is more than one', () => {
    const lines = optimumLines([stint(), stint({stint: 3})], 3);
    expect(lines.map(l => l.label)).toEqual(['Stint 1', 'Stint 3']);
  });

  it('is empty before the sectors and drops a stint under the floor', () => {
    expect(optimumLines([], 1)).toEqual([]);
    expect(optimumLines([stint({bestSumS: null})], 1)).toEqual([]);
    expect(optimumLines([stint({medianSumS: null})], 1)).toEqual([]);
  });
});
