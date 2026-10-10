import {describe, expect, it} from '@jest/globals';

import {
  columnStats,
  segmentBests,
  segmentOptimum,
  segmentStats,
  type SegmentTimes,
  sectionNamesLabel,
  turnRangeLabel,
} from './segments';

const lap = (
  id: string,
  stint: number,
  timesS: (number | null)[],
  comparable = true,
) => ({id, stint, comparable, timesS});

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
  it('gives best, median and p75 − p25 per segment', () => {
    const [s1] = segmentStats(make(['S1', 'S2', 'S3']));
    expect(s1.n).toBe(5);
    expect(s1.bestS).toBe(10);
    expect(s1.medianS).toBe(11);
    // sorted 10, 10.5, 11, 12, 13: p25 = 10.5, p75 = 12
    expect(s1.spreadS).toBeCloseTo(1.5);
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

describe('columnStats', () => {
  it('takes the median, best and IQR of exactly the times given', () => {
    expect(columnStats([10, 12, 11, 13])).toEqual({
      n: 4,
      bestS: 10,
      medianS: 11.5,
      spreadS: 1.5,
    });
  });

  it('counts a single time as its own median, with no spread', () => {
    expect(columnStats([7.5])).toEqual({
      n: 1,
      bestS: 7.5,
      medianS: 7.5,
      spreadS: 0,
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

  it('does not apply the traffic filter or the minimum count segmentStats uses', () => {
    expect(columnStats([10, 10.5]).medianS).toBe(10.25);
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

describe('a segment with tow or traffic in it', () => {
  it('is shown but counts for nothing on that lap', () => {
    const t = make(['T1', 'T2', 'T3']);
    // The fastest lap of segment 0 sat in a tow: its 10 s must not be the best.
    t.laps[0] = {...t.laps[0], alone: [false, true, true]};
    t.laps.push(lap('f', 1, [14, 23, 32]));
    expect(segmentBests(t)[0]).toBe(10.5);
    expect(segmentStats(t)[0].n).toBe(5);
    expect(segmentStats(t)[0].bestS).toBe(10.5);
    expect(segmentOptimum(t)[0].bestSumS).toBeCloseTo(10.5 + 19 + 28);
  });

  it('counts when it is not known whether there was anyone near', () => {
    const t = make(['S1', 'S2', 'S3']);
    expect(segmentBests(t)).toEqual([10, 19, 28]);
  });
});

describe('laps that are not comparable', () => {
  it('stay in the table but out of the stats and the optimum', () => {
    const t = make(['S1', 'S2', 'S3']);
    t.laps.push(lap('x', 1, [1, 1, 1], false));
    expect(segmentStats(t)[0].bestS).toBe(10);
    expect(segmentOptimum(t)[0].bestSumS).toBeCloseTo(10 + 19 + 28);
  });
});

describe('segmentBests', () => {
  it('is the fastest comparable time of each segment, with or without five laps', () => {
    const t = make(['S1', 'S2', 'S3']);
    t.laps = t.laps.slice(0, 2);
    t.laps.push(lap('x', 1, [1, 1, 1], false));
    expect(segmentBests(t)).toEqual([10, 19, 30]);
  });
});

describe('sectionNamesLabel', () => {
  it('reads one turn split into entry and apex as one name', () => {
    expect(sectionNamesLabel(['T7 entry', 'T7'])).toBe('T7');
  });
  it('keeps a real range and drops entry/exit inside it', () => {
    expect(sectionNamesLabel(['T2', 'T3', 'T4 exit', 'T5'])).toBe('T2–5');
  });
  it('a single corner is its name', () => {
    expect(sectionNamesLabel(['T10a'])).toBe('T10a');
  });
});
