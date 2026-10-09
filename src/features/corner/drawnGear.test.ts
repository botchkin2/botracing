import {describe, expect, it} from '@jest/globals';

import {drawnGear} from './drawnGear';

describe('drawnGear', () => {
  it('holds the previous gear through a shift instant', () => {
    // 5, then the in-between neutral, then 4: the neutral draws as 5.
    expect(drawnGear([5, 0, 4, 4])).toEqual([5, 5, 4, 4]);
  });

  it('holds through a run of neutrals', () => {
    expect(drawnGear([6, 0, 0, 5])).toEqual([6, 6, 6, 5]);
  });

  it('leaves the data alone: it returns a new array', () => {
    const gears = [5, 0, 4];
    drawnGear(gears);
    expect(gears).toEqual([5, 0, 4]);
  });

  it('a leading neutral takes the first gear that follows', () => {
    expect(drawnGear([0, 0, 3, 0, 4])).toEqual([3, 3, 3, 3, 4]);
  });

  it('keeps NaN gaps as they are', () => {
    expect(drawnGear([5, NaN, 0, 4])).toEqual([5, NaN, 5, 4]);
  });
});
