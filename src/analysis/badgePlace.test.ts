import {describe, expect, it} from '@jest/globals';

import {placeBadges} from './badgePlace';

const box = {width: 200, height: 100, d: 20};

describe('placeBadges', () => {
  it('keeps the first choice when it is clear and on the map', () => {
    expect(placeBadges([[{x: 50, y: 50}]], box)).toEqual([{x: 50, y: 50}]);
  });

  it('moves a badge that would cover an earlier one', () => {
    const [a, b] = placeBadges(
      [
        [{x: 50, y: 50}],
        [
          {x: 55, y: 50},
          {x: 80, y: 50},
        ],
      ],
      box,
    );
    expect(a).toEqual({x: 50, y: 50});
    expect(b).toEqual({x: 80, y: 50});
  });

  it('skips a spot off the top edge for one inside the loop', () => {
    const [a] = placeBadges(
      [
        [
          {x: 50, y: 2},
          {x: 50, y: 40},
        ],
      ],
      box,
    );
    expect(a).toEqual({x: 50, y: 40});
  });

  it('clamps onto the map when nothing better exists', () => {
    const [a] = placeBadges([[{x: -30, y: 50}]], box);
    expect(a).toEqual({x: 11, y: 50});
  });
});
