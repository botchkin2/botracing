import {describe, expect, it} from '@jest/globals';

import {heatCell} from './tokens';

describe('heatCell', () => {
  it('runs from dark to pale and clamps outside 0..1', () => {
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
    };
    expect(lum(heatCell(1))).toBeGreaterThan(lum(heatCell(0.5)));
    expect(lum(heatCell(0.5))).toBeGreaterThan(lum(heatCell(0)));
    expect(heatCell(-3)).toBe(heatCell(0));
    expect(heatCell(7)).toBe(heatCell(1));
    expect(heatCell(0.4)).toMatch(/^#[0-9a-f]{6}$/);
  });
});
