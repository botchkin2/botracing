import {describe, expect, it} from '@jest/globals';

import {
  segmentOptimum,
  segmentStats,
  type SegmentTimes,
  turnRangeLabel,
} from './segments';

const lap = (id: string, stint: number, timesS: (number | null)[]) => ({
  id,
  stint,
  timesS,
});

// Five laps, three segments, the same table read as turns and as sectors.
const rows: [string, (number | null)[]][] = [
  ['a', [10, 20, 30]],
  ['b', [11, 19, 31]],
  ['c', [12, 21, 29]],
  ['d', [10.5, 20.5, 30.5]],
  ['e', [13, 22, 28]],
];
const make = (labels: string[]): SegmentTimes => ({
  segments: labels.map(label => ({label, range: null})),
  laps: rows.map(([id, t]) => lap(id, 1, t)),
});

describe('segmentOptimum', () => {
  it('sums the best of each segment, whichever producer made them', () => {
    for (const labels of [
      ['T1', 'T2–5', 'T6'],
      ['S1', 'S2', 'S3'],
    ]) {
      const [stint] = segmentOptimum(make(labels));
      expect(stint.bestSumS).toBeCloseTo(10 + 19 + 28);
      expect(stint.windows).toHaveLength(3);
    }
  });

  it('has no optimum under five laps', () => {
    const few = {...make(['S1', 'S2', 'S3']), laps: [lap('a', 1, [1, 2, 3])]};
    expect(segmentOptimum(few)).toEqual([]);
  });
});

describe('segmentStats', () => {
  it('gives best, median and p90 − p10 per segment', () => {
    const [s1] = segmentStats(make(['S1', 'S2', 'S3']));
    expect(s1.n).toBe(5);
    expect(s1.bestS).toBe(10);
    expect(s1.medianS).toBe(11);
    // sorted 10, 10.5, 11, 12, 13: p10 = 10.2, p90 = 12.6
    expect(s1.spreadS).toBeCloseTo(2.4);
  });

  it('leaves a segment under the floor empty, and skips null times', () => {
    const t = make(['S1', 'S2', 'S3']);
    t.laps = t.laps.map((l, i) => (i < 2 ? lap(l.id, 1, [null, 1, 1]) : l));
    const stats = segmentStats(t);
    expect(stats[0]).toEqual({
      n: 3,
      bestS: null,
      medianS: null,
      spreadS: null,
    });
    expect(stats[1].n).toBe(5);
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
