import {describe, expect, it} from '@jest/globals';

import {basisOf} from './lapBasis';

const laps = [
  {id: 'a', comparable: true},
  {id: 'b', comparable: true},
  {id: 'x', comparable: false},
];

describe('basisOf', () => {
  it('is the ticked laps, comparable or not; the comparable ones when none is ticked', () => {
    expect(basisOf(laps, new Set(['x'])).map(l => l.id)).toEqual(['x']);
    expect(basisOf(laps, new Set()).map(l => l.id)).toEqual(['a', 'b']);
    expect(basisOf(laps, new Set(['gone'])).map(l => l.id)).toEqual(['a', 'b']);
  });
});
