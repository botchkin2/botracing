import {describe, expect, it} from '@jest/globals';

import {type SessionOptimum} from '@/src/data/sessions';

import {optimumFacts} from './optimumFacts';

const window = {bestS: 1, bestLapId: 'a', medianS: 1, n: 9};
const optimum = (over: Partial<SessionOptimum['stints'][number]> = {}) =>
  ({
    windows: [],
    stints: [
      {
        stint: 2,
        lapCount: 9,
        windows: [window, window],
        bestSumS: 108.62,
        medianSumS: 110.1,
        ...over,
      },
    ],
  }) as SessionOptimum;

describe('optimumFacts', () => {
  it('is empty before the windows', () => {
    expect(optimumFacts(null, 1)).toEqual([]);
  });

  it('names both sums with the laps and windows behind them', () => {
    expect(optimumFacts(optimum(), 1)).toEqual([
      {
        label: 'Best sections summed',
        value: '1:48.620 · 9 laps, 2 windows',
      },
      {
        label: 'Sum of window medians',
        value: '1:50.100 · 9 laps, 2 windows',
      },
    ]);
  });

  it('adds the stint when the session has more than one', () => {
    expect(optimumFacts(optimum(), 3)[0].label).toBe(
      'Best sections summed · stint 2',
    );
  });

  it('shows nothing for a stint with a window under the floor', () => {
    expect(
      optimumFacts(optimum({bestSumS: null, medianSumS: null}), 1),
    ).toEqual([]);
  });
});
