import {describe, expect, it} from '@jest/globals';

import {clampSlop} from './Pressable';

const box = (left: number, top: number, w: number, h: number) => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});
const asked = {top: 8, bottom: 8, left: 8, right: 8};

describe('clampSlop', () => {
  it('keeps the slop on every side that has empty space', () => {
    expect(clampSlop(box(100, 100, 20, 20), asked, [])).toEqual(asked);
    expect(
      clampSlop(box(100, 100, 20, 20), asked, [box(300, 300, 20, 20)]),
    ).toEqual(asked);
  });

  it('cuts a side to half the gap to a neighbour beside it', () => {
    // A control 6 pt to the right: 3 pt of slop on that side, the rest untouched.
    const out = clampSlop(box(100, 100, 20, 20), asked, [
      box(126, 100, 20, 20),
    ]);
    expect(out).toEqual({top: 8, bottom: 8, left: 8, right: 3});
  });

  it('cuts above and below the same way', () => {
    const out = clampSlop(box(100, 100, 20, 20), asked, [
      box(100, 60, 20, 20),
      box(100, 130, 20, 20),
    ]);
    expect(out).toEqual({top: 8, bottom: 5, left: 8, right: 8});
  });

  it('gives no slop toward a neighbour that touches or overlaps', () => {
    const out = clampSlop(box(100, 100, 20, 20), asked, [
      box(120, 100, 20, 20),
      box(90, 100, 20, 20),
    ]);
    expect(out.right).toBe(0);
    expect(out.left).toBe(0);
  });

  it('ignores a neighbour that is not in line with the control', () => {
    // Diagonal: no shared row or column, so it takes nothing.
    const out = clampSlop(box(100, 100, 20, 20), asked, [
      box(124, 124, 20, 20),
    ]);
    expect(out).toEqual(asked);
  });
});
