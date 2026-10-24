import {describe, expect, it} from '@jest/globals';

import {TINT_STEPS, stepOfName, tintColor} from './carTint';

describe('car tint', () => {
  it('step 0 leaves the class colour, each step is lighter, the last is well short of white', () => {
    expect(tintColor('#3366ff', 0)).toBe('#3366ff');
    const lum = (c: string) => parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16);
    for (let s = 1; s < TINT_STEPS; s++) expect(lum(tintColor('#3366ff', s))).toBeGreaterThan(lum(tintColor('#3366ff', s - 1)));
    expect(tintColor('#3366ff', TINT_STEPS - 1)).not.toBe('#ffffff');
  });
  it('keeps the hue order of the class colour (red stays the reddest channel)', () => {
    const c = tintColor('#ff0000', 5);
    const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
    expect(r).toBe(255);
    expect(g).toBe(b);
    expect(g).toBeGreaterThan(0);
  });
  it('clamps the step and hands anything that is not #rrggbb back as it was', () => {
    expect(tintColor('#3366ff', 99)).toBe(tintColor('#3366ff', TINT_STEPS - 1));
    expect(tintColor('#3366ff', -3)).toBe('#3366ff');
    expect(tintColor('rebeccapurple', 3)).toBe('rebeccapurple');
    expect(tintColor('#abc', 3)).toBe('#abc');
  });
  it('a model with no place in a family gets a stable step from its name, in range, 0 for no name', () => {
    expect(stepOfName(null)).toBe(0);
    expect(stepOfName('  ')).toBe(0);
    const a = stepOfName('Alpine A424');
    expect(stepOfName('alpine a424')).toBe(a);
    for (const n of ['Oreca 07', 'Ligier JS P217', 'Lexus RC F', 'x']) {
      const s = stepOfName(n);
      expect(Number.isInteger(s) && s >= 0 && s < TINT_STEPS).toBe(true);
    }
  });
});