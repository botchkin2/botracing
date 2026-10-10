import {describe, expect, it} from '@jest/globals';

import type {OffTrackEvent} from '@/src/analysis/offTrackEvents';

import {offTrackMarks} from './offTrackMarks';

const ev = (fromS: number, xM: number): OffTrackEvent => ({
  fromS,
  toS: fromS + 1,
  lap: 1,
  lapDistM: xM,
  xM,
  zM: 5,
});

describe('offTrackMarks', () => {
  const window = {fromS: 100, toS: 200};

  it('keeps the events that start inside the window', () => {
    const marks = offTrackMarks(
      [{carIndex: 0, events: [ev(50, 1), ev(100, 2), ev(150, 3), ev(201, 4)]}],
      window,
    );
    expect(marks.map(m => [m.xM, m.zM])).toEqual([
      [2, 5],
      [3, 5],
    ]);
  });

  it('adds the focused car after your own, with keys that differ per car', () => {
    const marks = offTrackMarks(
      [
        {carIndex: 0, events: [ev(120, 1)]},
        {carIndex: 7, events: [ev(120, 9)]},
      ],
      window,
    );
    expect(marks.map(m => m.xM)).toEqual([1, 9]);
    expect(new Set(marks.map(m => m.key)).size).toBe(2);
  });

  it('is empty with no events', () => {
    expect(offTrackMarks([], window)).toEqual([]);
    expect(offTrackMarks([{carIndex: 0, events: []}], window)).toEqual([]);
  });
});
