import {describe, expect, it} from '@jest/globals';

import {screenLateral, toScreenLateral} from './screenLateral';

describe('screenLateral', () => {
  it('flips the sign: data is +right, and a right turn draws below zero', () => {
    // A right-hander at the apex: steering and lateral position both +right.
    expect(toScreenLateral(12)).toBeLessThan(0);
    expect(toScreenLateral(-12)).toBeGreaterThan(0);
    expect(toScreenLateral(0)).toBe(0);
  });

  it('keeps the distances and does not mutate the recorded samples', () => {
    const recorded = {distanceM: [0, 5, 10], values: [0, 3, 6]};
    const screen = screenLateral(recorded);
    expect(screen.distanceM).toEqual([0, 5, 10]);
    expect(screen.values).toEqual([0, -3, -6]);
    expect(recorded.values).toEqual([0, 3, 6]);
  });
});
