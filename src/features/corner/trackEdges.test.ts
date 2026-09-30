import {describe, expect, it} from '@jest/globals';

import {edgeRuns} from './trackEdges';

const samples = (pairs: [number, number][]) => ({
  distanceM: pairs.map(p => p[0]),
  values: pairs.map(p => p[1]),
});

describe('edgeRuns', () => {
  it('keeps each side apart, signed, and only where a lap was on it', () => {
    // One lap on the right for 0-20 m, then it crosses and is on the left.
    const lap = samples([
      [2, 5.5],
      [7, 5.6],
      [12, 5.4],
      [22, -6.1],
      [27, -6.0],
    ]);
    const {right, left} = edgeRuns([lap], 0, 30);
    expect(right).toHaveLength(1);
    expect(right[0].distanceM).toEqual([2.5, 7.5, 12.5]);
    expect(right[0].values).toEqual([5.5, 5.6, 5.4]);
    expect(left).toHaveLength(1);
    expect(left[0].values).toEqual([-6.1, -6]);
  });

  it('two laps that visited both sides give both edges over the same stretch', () => {
    const a = samples([
      [2, 5.5],
      [7, 5.5],
    ]);
    const b = samples([
      [2, -6],
      [7, -6],
    ]);
    const {right, left} = edgeRuns([a, b], 0, 10);
    expect(right[0].values).toEqual([5.5, 5.5]);
    expect(left[0].values).toEqual([-6, -6]);
  });

  it('uses the median when laps disagree by a little', () => {
    const laps = [5.4, 5.5, 9].map(v => samples([[2, v]]));
    expect(edgeRuns(laps, 0, 10).right[0].values).toEqual([5.5]);
  });

  it('breaks a side into runs across a stretch nobody sampled on it', () => {
    const lap = samples([
      [2, 5.5],
      [7, 5.5],
      [32, 5.5],
    ]);
    const {right} = edgeRuns([lap], 0, 40);
    expect(right.map(r => r.distanceM)).toEqual([[2.5, 7.5], [32.5]]);
  });

  it('ignores samples outside the window and missing values', () => {
    const lap = samples([
      [-4, 5],
      [2, NaN],
      [7, 5.5],
      [90, 5],
    ]);
    expect(edgeRuns([lap], 0, 30).right[0].values).toEqual([5.5]);
    expect(edgeRuns([], 0, 30)).toEqual({right: [], left: []});
  });
});
