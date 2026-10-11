import {describe, expect, it} from '@jest/globals';

import {
  DIMMED_OPACITY,
  lapColor,
  lapColors,
  lapMode,
  lapStroke,
  RESERVED_HUE_GAP,
  reservedHues,
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

describe('generated hues avoid the reserved colours', () => {
  const hueOfColour = (c: string) => Number(/hsl\(([\d.]+)/.exec(c)![1]);
  const dist = (a: number, b: number) => {
    const d = Math.abs(a - b) % 360;
    return Math.min(d, 360 - d);
  };
  it('no generated lap hue is within 15 degrees of slower, faster, best, accent or off-track', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const reserved = reservedHues(scheme);
      for (let i = 7; i < 120; i++) {
        const h = hueOfColour(lapColor(scheme, i));
        for (const r of reserved)
          expect(dist(h, r)).toBeGreaterThanOrEqual(RESERVED_HUE_GAP);
      }
    }
  });

  it('keeps every lap a distinct colour with the reserved bands skipped', () => {
    const colours = Array.from({length: 120}, (_, i) =>
      lapColor('dark', i + 1),
    );
    expect(new Set(colours).size).toBe(120);
  });
});
