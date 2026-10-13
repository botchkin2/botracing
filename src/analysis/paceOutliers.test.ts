import {describe, expect, it} from '@jest/globals';

import {
  MIN_OUTLIER_LAPS,
  MIN_STINT_PACE_LAPS,
  paceOutliers,
  type PaceLap,
} from './consistency';

// A steady stint: lap n of `count`, a hundredth or two of scatter.
const stint = (n: number, count: number, base = 80): PaceLap[] =>
  Array.from({length: count}, (_, i) => ({
    id: `s${n}l${i}`,
    stint: n,
    stintLap: i,
    lapTime: base + (i % 3) * 0.04,
  }));

const ids = (laps: readonly PaceLap[]) => paceOutliers(laps).map(o => o.id);

describe('paceOutliers', () => {
  it('marks a lap far slower than its stint, with how much', () => {
    const laps = [
      ...stint(1, 12),
      {id: 'slow', stint: 1, stintLap: 10, lapTime: 89},
    ];
    expect(paceOutliers(laps)).toEqual([
      {id: 'slow', residualS: expect.closeTo(9, 0)},
    ]);
  });

  it('leaves fast laps in: a lap cannot be unusually fast', () => {
    const laps = [
      ...stint(1, 12),
      {id: 'fast', stint: 1, stintLap: 10, lapTime: 78},
    ];
    expect(ids(laps)).toEqual([]);
  });

  it('judges each stint against its own trend, and the whole session on one sigma', () => {
    // Stint 2 is 3 s slower overall (heavier, older tyres): not an outlier.
    const laps = [
      ...stint(1, 9, 80),
      ...stint(2, 9, 83),
      {id: 'slow', stint: 2, stintLap: 9, lapTime: 93},
    ];
    expect(ids(laps)).toEqual(['slow']);
  });

  it('follows a pace trend along the stint', () => {
    // Fuel burning off: 0.05 s quicker each lap; the last lap is no outlier.
    const laps = Array.from({length: 12}, (_, i) => ({
      id: `t${i}`,
      stint: 1,
      stintLap: i,
      lapTime: 82 - i * 0.05,
    }));
    expect(ids(laps)).toEqual([]);
  });

  it('judges nothing under the minimum number of laps', () => {
    const few = [
      ...stint(1, MIN_OUTLIER_LAPS - 2),
      {id: 'slow', stint: 1, stintLap: 9, lapTime: 95},
    ];
    expect(few).toHaveLength(MIN_OUTLIER_LAPS - 1);
    expect(ids(few)).toEqual([]);
  });

  it('does not judge the laps of a stint too short to have a pace trend', () => {
    const laps = [...stint(1, 12), ...stint(2, MIN_STINT_PACE_LAPS - 1, 95)];
    expect(ids(laps)).toEqual([]);
  });

  it('is empty without laps', () => {
    expect(paceOutliers([])).toEqual([]);
  });
});

describe('paceOutliers: a run of slow laps is a pace change', () => {
  // Twelve steady laps, then slow ones at the end of the stint.
  const withTail = (slow: number[]): PaceLap[] => [
    ...stint(1, 12),
    ...slow.map((t, i) => ({
      id: `tail${i}`,
      stint: 1,
      stintLap: 12 + i,
      lapTime: t,
    })),
  ];

  it('drops one or two isolated slow laps', () => {
    expect(ids(withTail([88]))).toEqual(['tail0']);
    expect(ids(withTail([88, 89]))).toEqual(['tail0', 'tail1']);
  });

  it('keeps three or more slow laps in a row: tyres fading is the pace, not a mistake', () => {
    expect(ids(withTail([88, 89, 88]))).toEqual([]);
    expect(ids(withTail([88, 89, 88, 90]))).toEqual([]);
  });

  it('counts a run per stint, and a good lap in between breaks it', () => {
    const laps = [
      ...stint(1, 12),
      {id: 'a', stint: 1, stintLap: 12, lapTime: 88},
      {id: 'b', stint: 1, stintLap: 13, lapTime: 89},
      {id: 'ok', stint: 1, stintLap: 14, lapTime: 80},
      {id: 'c', stint: 1, stintLap: 15, lapTime: 88},
    ];
    expect(ids(laps)).toEqual(['a', 'b', 'c']);
  });
});
