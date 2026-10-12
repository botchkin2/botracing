import {describe, expect, it} from '@jest/globals';

import {
  screenLateral,
  screenLateralOnce,
  screenValuesOnce,
  toScreenLateral,
} from './screenLateral';
import {chunkPath, type ChunkFrame} from './chunkPaths';

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

// The charts cache a built line under the identity of the array they draw
// (chunkPaths.ts). A flip that returned a new array on every render rebuilt
// every steering line on every playback frame.
describe('the flip is made once per source', () => {
  const recorded = {distanceM: [0, 5, 10], values: [0, 3, 6]};

  it('returns the same samples object for the same source, flipped as screenLateral does', () => {
    const a = screenLateralOnce(recorded);
    expect(screenLateralOnce(recorded)).toBe(a);
    expect(a).toEqual(screenLateral(recorded));
    expect(screenLateralOnce({...recorded})).not.toBe(a);
  });

  it('returns the same values array for the same source array', () => {
    const grid = [1, -2, 3];
    const a = screenValuesOnce(grid);
    expect(screenValuesOnce(grid)).toBe(a);
    expect(a).toEqual([-1, 2, -3]);
    expect(grid).toEqual([1, -2, 3]);
  });

  it('lets a chart reuse the line it built: the second frame reads the cache', () => {
    const grid = Array.from({length: 400}, (_, i) => Math.sin(i / 20) * 50);
    let built = 0;
    const frame = {
      key: 'k',
      uOfM: (m: number) => m,
      uOfIndex: (i: number) => i * 5,
      stepM: 5,
      sx: 1,
      y: (v: number) => {
        built++;
        return 100 - v;
      },
      chunkPx: 600,
      mPerPx: 1,
    } as ChunkFrame;
    const draw = () => chunkPath({values: screenValuesOnce(grid)}, frame, 0);
    const first = draw();
    const callsAfterFirst = built;
    expect(draw()).toBe(first);
    expect(built).toBe(callsAfterFirst);
  });
});
