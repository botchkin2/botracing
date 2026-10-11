import {describe, expect, it} from '@jest/globals';

import {
  DIMMED_OPACITY,
  lapColor,
  lapColors,
  lapMode,
  lapStroke,
  stroke,
} from './tokens';

describe('lap colours at any count', () => {
  it('gives every lap of a 40-lap selection its own colour, none of them the Ref or the median colour', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const colours = Array.from(
        {length: 40},
        (_, i) => lapStroke(scheme, i + 1, false).color,
      );
      expect(new Set(colours).size).toBe(40);
      expect(colours).not.toContain(lapColors[scheme][0]);
      expect(colours).not.toContain(lapStroke(scheme, -1, false).color);
    }
  });

  it('keeps the palette for the first laps, then generated hues', () => {
    expect(lapColor('dark', 1)).toBe(lapColors.dark[1]);
    expect(lapColor('dark', 7)).not.toBe(lapColors.dark[6]);
  });

  it('draws every lap at full opacity when nothing is highlighted', () => {
    expect(lapStroke('dark', 9, false).opacity).toBe(1);
    expect(lapStroke('dark', 9, false, false).key).toBe(true);
  });
});

describe('highlighting one lap', () => {
  it('thickens it and dims every other lap', () => {
    const hl = lapStroke('dark', 9, true, true);
    expect(hl.width).toBe(stroke.ref);
    expect(hl.opacity).toBe(1);
    const other = lapStroke('dark', 10, false, true);
    expect(other.opacity).toBe(DIMMED_OPACITY);
    expect(other.width).toBe(stroke.selected);
  });

  it('leaves the reference and the median basis as they are', () => {
    expect(lapStroke('dark', 0, false, true).opacity).toBe(1);
    expect(lapStroke('dark', -1, false, true).opacity).toBe(1);
  });
});

describe('one threshold', () => {
  it('is individual up to six laps and several above', () => {
    expect(lapMode(6)).toBe('individual');
    expect(lapMode(7)).toBe('several');
  });
});
