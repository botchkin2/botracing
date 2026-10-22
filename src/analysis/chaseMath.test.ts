import {describe, expect, it} from '@jest/globals';

import {ease} from './chaseMath';

describe('ease', () => {
  it('closes more of the gap the longer the step, never all of it', () => {
    expect(ease(0.1, 0.3)).toBeCloseTo(1 - Math.exp(-1 / 3), 12);
    expect(ease(1e9, 0.3)).toBe(1);
    expect(ease(0.2, 0.3)).toBeGreaterThan(ease(0.1, 0.3));
  });
  it('a step of no time moves nothing, with a time constant or without (0 / 0 is NaN)', () => {
    expect(ease(0, 0.3)).toBe(0);
    expect(ease(0, 0)).toBe(0);
  });
  it('a camera that is not smoothed (tau 0) arrives at once on any positive step', () => {
    expect(ease(1e-9, 0)).toBe(1);
    expect(ease(0.016, 0)).toBe(1);
  });
  it('negative or unknown time moves nothing and is never NaN', () => {
    for (const dt of [-0.016, -1e9, NaN]) for (const tau of [0, 0.3, NaN]) {
      const k = ease(dt, tau);
      expect(Number.isFinite(k)).toBe(true);
      expect(k).toBe(0);
    }
  });
});
