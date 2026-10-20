import {describe, expect, it} from '@jest/globals';

import {bankOnLap} from './bank';

const bank = {stepM: 5, rollDeg: [0, 2, 4, 2, -2]}; // 5 points: 0 to 20 m of a 25 m lap

describe('bankOnLap', () => {
  it('interpolates between the profile points', () => {
    expect(bankOnLap(bank, 0, 25)).toBe(0);
    expect(bankOnLap(bank, 7.5, 25)).toBeCloseTo(3, 10);
    expect(bankOnLap(bank, 10, 25)).toBe(4);
  });

  it('wraps round the lap and runs the last point back to the first with no step at the line', () => {
    expect(bankOnLap(bank, 25, 25)).toBe(0);
    expect(bankOnLap(bank, 50.0, 25)).toBe(0);
    expect(bankOnLap(bank, -5, 25)).toBe(-2);
    // 20 m is the last point (-2); the 5 m left of the lap runs to the first (0)
    expect(bankOnLap(bank, 22.5, 25)).toBeCloseTo(-1, 10);
    expect(Math.abs(bankOnLap(bank, 24.99, 25) - bankOnLap(bank, 0, 25))).toBeLessThan(0.01);
  });

  it('reads a lap longer or shorter than its last point without leaving the profile', () => {
    expect(bankOnLap(bank, 20, 21)).toBe(-2);
    expect(bankOnLap(bank, 1000, 25)).toBe(bankOnLap(bank, 0, 25));
  });
});
