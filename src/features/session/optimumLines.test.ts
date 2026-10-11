import {describe, expect, it} from '@jest/globals';

import {type SegmentStats} from '@/src/analysis/segments';

import {optimumLines} from './optimumLines';
import {type StintNumbers} from './selectionStats';

const stats = (medianS: number | null): SegmentStats => ({
  n: 9,
  bestS: 108,
  medianS,
  spreadS: 0.4,
});

const stint = (over: Partial<StintNumbers> = {}): StintNumbers => ({
  stint: 1,
  n: 9,
  lapTimes: stats(109.4),
  optimalS: 108.62,
  inconsistencyS: 0.78,
  ...over,
});

describe('optimumLines', () => {
  it('is one line per stint: Optimal, Median lap time, the gap, and how many laps', () => {
    expect(optimumLines([stint()], 1)).toEqual([
      {
        label: null,
        optimal: '1:48.620',
        median: '1:49.400',
        inconsistency: '+0.780 s',
        of: 'of 9',
      },
    ]);
  });

  it('names the stint only when there is more than one', () => {
    const lines = optimumLines([stint(), stint({stint: 3})], 3);
    expect(lines.map(l => l.label)).toEqual(['Stint 1', 'Stint 3']);
  });

  it('follows the ticked laps: a smaller n and a moved median read through', () => {
    const [line] = optimumLines(
      [stint({n: 8, lapTimes: stats(109.37), inconsistencyS: 0.75})],
      1,
    );
    expect(line.of).toBe('of 8');
    expect(line.median).toBe('1:49.370');
  });

  it('is empty before the segments and drops a stint without an Optimal or a median', () => {
    expect(optimumLines([], 1)).toEqual([]);
    expect(optimumLines([stint({optimalS: null})], 1)).toEqual([]);
    expect(optimumLines([stint({lapTimes: stats(null)})], 1)).toEqual([]);
    expect(optimumLines([stint({inconsistencyS: null})], 1)).toEqual([]);
  });
});
