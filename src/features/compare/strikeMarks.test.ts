import {describe, expect, it} from '@jest/globals';

import type {Lap} from '@/src/data/sessions';

import {strikeMarksOf, strikeText} from './strikeMarks';

const ref = (lapId: string, label: string, selIndex: number) => ({
  lapId,
  label,
  selIndex,
  isRef: false,
  highlighted: false,
});
const lap = (trackLimits: unknown) => ({trackLimits} as unknown as Lap);
const strike = (
  atM: number | null,
  widthM: number | null,
  ruling = 'Warning',
) => ({
  et: 1,
  atM,
  widthM,
  points: 1,
  outcome: 'warning',
  ruling,
});

describe('strike marks on the Compare map', () => {
  const laps: Record<string, Lap> = {
    a: lap([strike(1200, 0.42), strike(null, null)]),
    b: lap(null),
    c: lap([strike(300, 1.25, 'No Further Action')]),
  };
  const marks = strikeMarksOf(
    [
      ref('a', 'L7', 0),
      ref('b', 'L8', 1),
      ref('c', 'L9', 2),
      ref('d', 'L10', 3),
    ],
    id => laps[id],
    (id, m) => (id === 'c' ? null : {x: m, y: 0}),
  );

  it('places each strike that has a position on a selected lap that has a trace', () => {
    expect(marks.map(m => [m.key, m.at.x, m.widthM])).toEqual([
      ['a:0', 1200, 0.42],
    ]);
  });

  it('reads the lap, how far past the edge, and the game words', () => {
    expect(strikeText({label: 'L7', widthM: 0.42, ruling: 'Warning'})).toBe(
      'L7 · 0.4 m past the edge · Warning',
    );
    expect(strikeText({label: 'L9', widthM: null, ruling: ''})).toBe('L9');
  });
});
