import {describe, expect, it} from '@jest/globals';

import {MIN_SPREAD_LAPS, spreadShares} from './spreadShare';

// Twelve laps; section times around a base, a spread of `amp` seconds.
const col = (base: number, amp: number, n = 12) =>
  Array.from({length: n}, (_, i) => base + amp * ((i % 4) - 1.5));

describe('spreadShares', () => {
  it('ranks the sections by their share of the spread, biggest first, adding to 1', () => {
    const out = spreadShares([col(10, 0.1), col(20, 0.4), col(15, 0.2)])!;
    expect(out.map(s => s.index)).toEqual([1, 2, 0]);
    expect(out.reduce((t, s) => t + s.share, 0)).toBeCloseTo(1, 10);
    // Squared amplitudes 0.01 : 0.16 : 0.04 -> the middle holds 16/21.
    expect(out[0].share).toBeCloseTo(16 / 21, 6);
  });

  it('a scatter of 2 s against 1 s is four times the share, not twice', () => {
    const [a, b] = spreadShares([col(10, 0.2), col(10, 0.1)])!;
    expect(a.share / b.share).toBeCloseTo(4, 6);
  });

  it('one wild lap in a section does not make it the culprit (the spread is robust)', () => {
    const wild = col(20, 0.1);
    wild[3] = 29;
    const out = spreadShares([col(10, 0.1), wild])!;
    expect(out[0].share).toBeCloseTo(0.5, 2);
  });

  it('shows nothing under MIN_SPREAD_LAPS laps, and counts only the sections that have them', () => {
    expect(MIN_SPREAD_LAPS).toBe(10);
    expect(spreadShares([col(10, 0.1, 9), col(20, 0.2, 9)])).toBeNull();
    // A section with 9 times is left out; a lone section left is no ranking.
    expect(spreadShares([col(10, 0.1, 12), col(20, 0.2, 9)])).toBeNull();
    const out = spreadShares([
      col(10, 0.1, 12),
      col(20, 0.2, 12),
      col(5, 1, 9),
    ])!;
    expect(out.map(s => s.index)).toEqual([1, 0]);
  });

  it('skips missing times and answers null when nothing scatters', () => {
    const gappy = [...col(10, 0.1), null, undefined, NaN];
    expect(spreadShares([gappy, col(20, 0.3)])!.map(s => s.index)).toEqual([
      1, 0,
    ]);
    expect(spreadShares([col(10, 0), col(20, 0)])).toBeNull();
    expect(spreadShares([])).toBeNull();
  });
});
