import {describe, expect, it} from '@jest/globals';

import {brakeSpread} from './brakeSpread';

// Twelve laps braking `amp` metres either side of `at`.
const zone = (at: number, amp: number, n = 12) =>
  Array.from({length: n}, (_, i) => at + amp * ((i % 5) - 2));

describe('brakeSpread', () => {
  it('ranks the zones loosest first, with the median and the p10-p90 spread in metres', () => {
    const out = brakeSpread([zone(500, 2), zone(1400, 10), zone(2600, 5)]);
    expect(out.map(z => z.index)).toEqual([1, 2, 0]);
    expect(Math.abs(out[0].medianM - 1400)).toBeLessThan(10);
    // Offsets are -20..+20 in steps of 10; p10 and p90 interpolate the 12 laps.
    expect(out[0].spreadM).toBeCloseTo(out[2].spreadM * 5, 6);
    expect(out[0].offsetsM.filter(o => o != null)).toHaveLength(12);
  });

  it('skips laps that did not brake, and a zone with under ten laps that did', () => {
    const gappy = [...zone(800, 4, 10), null, undefined, NaN];
    const [z] = brakeSpread([gappy, zone(900, 4, 9)]);
    expect(z.index).toBe(0);
    expect(z.n).toBe(10);
    expect(z.offsetsM.slice(-3)).toEqual([null, null, null]);
    expect(brakeSpread([zone(900, 4, 9)])).toEqual([]);
  });

  it('a lap that always brakes at the same metre has no spread, and is still listed', () => {
    const [z] = brakeSpread([Array(12).fill(700)]);
    expect(z.spreadM).toBe(0);
    expect(z.offsetsM.every(o => o === 0)).toBe(true);
  });
});
