import {describe, expect, it} from '@jest/globals';

import {lapPath} from './inputsPath';
import type {RaceClock} from './raceClock';

// a player doing 10 m/s along +x from lap distance 0, who never gets past 40 m of the lap (it ended in the pits)
const clock: RaceClock = {
  playerAt: () => null,
  timeAtLapDistance: (_lap, d) => (d <= 40 ? d / 10 : null),
};
const pose = (t: number) => ({x: t * 10, y: 2});

describe('lapPath', () => {
  it('is the player\'s own world path at each distance of the lap', () => {
    const p = lapPath(clock, 3, 6, 10, pose)!;
    expect(p.x.slice(0, 5)).toEqual([0, 10, 20, 30, 40]);
    expect(p.y.slice(0, 5)).toEqual([2, 2, 2, 2, 2]);
  });
  it('holds the last point where the lap ended early, and the first before he started', () => {
    const p = lapPath({...clock, timeAtLapDistance: (_l, d) => (d >= 10 && d <= 20 ? d / 10 : null)}, 0, 5, 10, pose)!;
    expect(p.x).toEqual([10, 10, 20, 20, 20]);
  });
  it('is null when he never drove the lap', () => {
    expect(lapPath({...clock, timeAtLapDistance: () => null}, 9, 4, 10, pose)).toBeNull();
    expect(lapPath(clock, 0, 4, 10, () => null)).toBeNull();
  });
});
