import {describe, expect, it} from '@jest/globals';

import {stackDots} from './dotStack';

describe('stackDots', () => {
  it('leaves separate dots on the line', () => {
    expect(
      stackDots(
        [
          {x: 10, value: 1},
          {x: 30, value: 2},
        ],
        6,
        0,
      ),
    ).toEqual([0, 0]);
  });

  it('stacks overlapping dots alternately above and below', () => {
    const dots = [0, 1, 2, 3].map(i => ({x: 50 + i, value: i}));
    expect(stackDots(dots, 6, 0)).toEqual([0, 1, -1, 2]);
  });

  it('treats values within the resolution as the same point', () => {
    // 1 m apart on screen by 20 pt, but inside ±1.2 m.
    expect(
      stackDots(
        [
          {x: 10, value: 100},
          {x: 30, value: 101},
        ],
        6,
        1.2,
      ),
    ).toEqual([0, 1]);
  });
});
