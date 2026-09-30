import {describe, expect, it} from '@jest/globals';

import {WORLD_MATCH_MAX_M, worldMatches, worldMatchM} from './worldMatch';

// A 1 km straight, a vertex every 5 m.
const line = Array.from({length: 201}, (_, i) => ({x: i * 5, y: 0}));

describe('worldMatchM', () => {
  it('is small for a player on the line', () => {
    const player = Array.from({length: 50}, (_, i) => ({x: i * 7.3, y: 1.5}));
    expect(worldMatchM(player, line)!).toBeLessThan(4);
  });

  it('is large for a player shifted off it', () => {
    const player = Array.from({length: 50}, (_, i) => ({x: i * 7.3, y: 60}));
    expect(worldMatchM(player, line)!).toBeGreaterThan(50);
  });

  it('takes the median, so a few stray points do not decide it', () => {
    const player = [
      ...Array.from({length: 45}, (_, i) => ({x: i * 9, y: 2})),
      ...Array.from({length: 5}, () => ({x: 500, y: 900})),
    ];
    expect(worldMatchM(player, line)!).toBeLessThan(4);
  });

  it('is null with nothing to compare', () => {
    expect(worldMatchM([], line)).toBeNull();
    expect(worldMatchM([{x: 0, y: 0}], [])).toBeNull();
  });

  it('uses every step-th point', () => {
    // Points alternate on and far off the line; step 2 sees only the first kind.
    const player = Array.from({length: 40}, (_, i) => ({
      x: i * 10,
      y: i % 2 === 0 ? 0 : 500,
    }));
    expect(worldMatchM(player, line, 2)).toBe(0);
  });
});

describe('worldMatches', () => {
  it('accepts up to the limit and refuses beyond or with no measure', () => {
    expect(worldMatches(WORLD_MATCH_MAX_M)).toBe(true);
    expect(worldMatches(WORLD_MATCH_MAX_M + 0.1)).toBe(false);
    expect(worldMatches(null)).toBe(false);
  });
});
