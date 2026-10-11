import {describe, expect, it} from '@jest/globals';

import {
  centredBaseline,
  insideFrame,
  labelBox,
  labelRowHeight,
  thinLabels,
} from './labelBox';

const frame = {width: 100, height: 40};
const inside = (
  text: string,
  x: number,
  y: number,
  anchor: 'start' | 'middle' | 'end',
) => {
  const at = insideFrame(text, x, y, 10, anchor, frame);
  return labelBox(text, at.x, at.baseline, 10, anchor);
};
const within = (b: {
  left: number;
  right: number;
  top: number;
  bottom: number;
}) =>
  b.left >= 1 - 1e-9 &&
  b.right <= frame.width - 1 + 1e-9 &&
  b.top >= 1 - 1e-9 &&
  b.bottom <= frame.height - 1 + 1e-9;

describe('labelBox', () => {
  it('is 0.6 em a glyph wide and 1.34 em tall', () => {
    expect(labelBox('100 %', 10, 20, 10, 'start')).toEqual({
      left: 10,
      right: 40,
      top: 9.6,
      bottom: 23,
    });
    expect(labelBox('L2', 50, 20, 10, 'middle').left).toBe(44);
    expect(labelBox('L2', 50, 20, 10, 'end').right).toBe(50);
  });
});

describe('insideFrame', () => {
  it('leaves a label that fits where it is', () => {
    expect(insideFrame('260', 3, 20, 10, 'start', frame)).toEqual({
      x: 3,
      baseline: 20,
    });
  });

  it('moves a top tick down just enough (the Corner "260" at the plot top)', () => {
    const at = insideFrame('260', 3, 6, 10, 'start', frame);
    expect(at.baseline).toBeCloseTo(11.4);
    expect(within(inside('260', 3, 6, 'start'))).toBe(true);
  });

  it('holds a right-aligned tag at the right and bottom edges (the Laps key)', () => {
    expect(within(inside('TRAF', 101, 39, 'end'))).toBe(true);
    expect(within(inside('L30', 99, 45, 'middle'))).toBe(true);
    expect(within(inside('PIT', -4, -2, 'start'))).toBe(true);
  });

  it('keeps the start edge of a label wider than the frame', () => {
    const at = insideFrame('x'.repeat(30), 10, 20, 10, 'start', frame);
    expect(at.x).toBe(1);
  });

  it('keeps the top edge of a label taller than the frame', () => {
    const at = insideFrame('L', 5, 30, 50, 'start', frame);
    expect(labelBox('L', at.x, at.baseline, 50, 'start').top).toBe(1);
  });
});

describe('labelBox widths', () => {
  it('counts the true minus as one glyph', () => {
    expect(labelBox('−50 %', 0, 0, 10, 'start').right).toBe(30);
  });
});

describe('labelRowHeight', () => {
  it('holds a centred label inside its row, so rows of labels never touch', () => {
    for (const fontSize of [9, 10, 12]) {
      const h = labelRowHeight(fontSize);
      const rows = [0, 1, 2].map(i => {
        const baseline = centredBaseline(i * h + h / 2, fontSize);
        return {
          box: labelBox('PIT', 0, baseline, fontSize, 'start'),
          baseline,
        };
      });
      // The first sits EDGE_PT inside the frame: insideFrame does not move it.
      const first = insideFrame('PIT', 0, rows[0].baseline, fontSize, 'start', {
        width: 100,
        height: 3 * h,
      });
      expect(first.baseline).toBeCloseTo(rows[0].baseline, 6);
      for (let i = 1; i < rows.length; i++)
        expect(rows[i].box.top).toBeGreaterThan(rows[i - 1].box.bottom);
    }
  });
});

describe('thinLabels', () => {
  const ticks = [0, 1, 2, 3, 4].map(v => ({v}));
  it('labels every tick when they fit, and keeps both ends when they do not', () => {
    expect(thinLabels(ticks, v => v * 100, 40)).toHaveLength(5);
    // 60 pt labels on a 50 pt pitch: every other one, both ends kept.
    expect(thinLabels(ticks, v => v * 50, 60).map(t => t.v)).toEqual([0, 2, 4]);
    // 120 pt labels: k = 3 does not divide 4, so k = 4, the two ends.
    expect(thinLabels(ticks, v => v * 50, 120).map(t => t.v)).toEqual([0, 4]);
  });
  it('works on either axis: positions may run backwards (a y axis, a flipped strip)', () => {
    expect(thinLabels(ticks, v => -v * 50, 60).map(t => t.v)).toEqual([
      0, 2, 4,
    ]);
  });
});
