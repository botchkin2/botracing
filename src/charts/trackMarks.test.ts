import {describe, expect, it} from '@jest/globals';

import {buildTrackMarks} from './trackMarks';

// A straight 1000 m "lap": distance maps to x.
const pointAt = (m: number) => ({x: m, y: 0});

const corner = (n: number, entryM: number, apexM: number, exitM: number) => ({
  n,
  entryM,
  apexM,
  exitM,
});

const sections = [
  {...corner(2, 500, 600, 700), parts: []},
  {
    ...corner(1, 100, 200, 400),
    parts: [corner(1, 100, 150, 200), corner(2, 250, 300, 400)],
  },
];

describe('buildTrackMarks', () => {
  const marks = buildTrackMarks(sections, 1000, pointAt);

  it('ticks each section entry, in lap order', () => {
    expect(marks.boundaries.map(b => b.at.x)).toEqual([100, 500]);
  });

  it('puts section labels halfway to the next entry, wrapping the last', () => {
    expect(marks.sections).toEqual([
      expect.objectContaining({
        n: 1,
        anchor: expect.objectContaining({at: {x: 300, y: 0}}),
      }),
      // 500 → 1100 (the first entry on the next lap), halfway is 800.
      expect.objectContaining({
        n: 2,
        anchor: expect.objectContaining({at: {x: 800, y: 0}}),
      }),
    ]);
  });

  it('numbers corners at their apex, using the section when it has no parts', () => {
    expect(marks.corners.map(c => [c.n, c.anchor.at.x])).toEqual([
      [1, 150],
      [2, 300],
      [2, 600],
    ]);
  });

  it('gives each anchor neighbours along the line', () => {
    const b = marks.boundaries[0];
    expect(b.prev.x).toBe(90);
    expect(b.next.x).toBe(110);
  });
});
