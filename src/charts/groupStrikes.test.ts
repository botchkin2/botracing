import {describe, expect, it} from '@jest/globals';

import {groupStrikes} from './groupStrikes';

describe('groupStrikes', () => {
  it('puts his three Warnings at 503-507 m (a few points apart) in one target, and a far one apart', () => {
    const groups = groupStrikes(
      [
        {key: 'a', x: 100, y: 100},
        {key: 'b', x: 103, y: 101},
        {key: 'c', x: 106, y: 99},
        {key: 'd', x: 300, y: 40},
      ],
      22,
    );
    expect(groups.map(g => g.keys)).toEqual([['a', 'b', 'c'], ['d']]);
  });

  it('keeps each strike its own target when none are close', () => {
    expect(
      groupStrikes(
        [
          {key: 'a', x: 0, y: 0},
          {key: 'b', x: 100, y: 0},
        ],
        22,
      ).map(g => g.keys),
    ).toEqual([['a'], ['b']]);
  });
});
