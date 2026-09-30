import {describe, expect, it} from '@jest/globals';

import {splitOutline, type Pt} from './outlineUse';

const line = (x0: number, y0: number, x1: number, y1: number, n = 2): Pt[] =>
  Array.from({length: n}, (_, i) => ({
    x: x0 + ((x1 - x0) * i) / (n - 1),
    y: y0 + ((y1 - y0) * i) / (n - 1),
  }));
const length = (l: Pt[]) =>
  l.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - l[i].x, p.y - l[i].y), 0);
const total = (ls: Pt[][]) => ls.reduce((s, l) => s + length(l), 0);

// A driven straight 1 km long along y = 0.
const driven = line(0, 0, 1000, 0, 201);

describe('splitOutline', () => {
  it('calls a way on the driven line used', () => {
    const r = splitOutline([line(0, 3, 1000, 3)], driven);
    expect(total(r.used)).toBeCloseTo(1000, 0);
    expect(r.unused).toEqual([]);
  });

  it('calls a way away from it unused', () => {
    const r = splitOutline([line(0, 60, 1000, 60)], driven);
    expect(r.used).toEqual([]);
    expect(total(r.unused)).toBeCloseTo(1000, 0);
  });

  it('respects the distance threshold', () => {
    expect(splitOutline([line(0, 7, 1000, 7)], driven).unused).toEqual([]);
    expect(splitOutline([line(0, 9, 1000, 9)], driven).used).toEqual([]);
    expect(
      splitOutline([line(0, 9, 1000, 9)], driven, {maxDistM: 10}).unused,
    ).toEqual([]);
  });

  it('splits one way that leaves the driven line', () => {
    // 600 m along the driven line, then 400 m straight off it.
    const way = [
      ...line(0, 0, 600, 0, 7),
      ...line(600, 0, 600, 400, 5).slice(1),
    ];
    const r = splitOutline([way], driven);
    expect(total(r.used)).toBeGreaterThan(590);
    expect(total(r.used)).toBeLessThan(640);
    expect(total(r.unused)).toBeGreaterThan(360);
    // The pieces meet, so the two draw as one road.
    const a = r.used[0];
    const b = r.unused[0];
    const end = a[a.length - 1];
    expect(Math.hypot(end.x - b[0].x, end.y - b[0].y)).toBe(0);
  });

  it('does not cut a used way into dashes at a short gap', () => {
    // The middle 20 m of the way bulges 12 m off the line: 28 m out of range.
    const way = [
      ...line(0, 0, 490, 0, 50),
      ...line(490, 12, 510, 12, 3),
      ...line(510, 0, 1000, 0, 50),
    ];
    const r = splitOutline([way], driven);
    expect(r.unused).toEqual([]);
  });

  it('keeps a short stub at the end of a line as it is', () => {
    // 20 m off the end of the driven line is a real dead end, not noise.
    const r = splitOutline([line(1000, 0, 1000, 20)], driven);
    expect(total(r.unused) + total(r.used)).toBeGreaterThan(19);
  });

  it('dims nothing without a driven line', () => {
    const ways = [line(0, 60, 1000, 60)];
    expect(splitOutline(ways, [])).toEqual({used: ways, unused: []});
  });

  it('skips degenerate ways', () => {
    const r = splitOutline([[], [{x: 1, y: 1}], line(5, 5, 5, 5)], driven);
    expect(r).toEqual({used: [], unused: []});
  });
});
