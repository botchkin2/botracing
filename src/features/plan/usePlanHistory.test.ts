import {describe, expect, it} from '@jest/globals';

import {sessionsWithLaps} from './usePlanHistory';

describe('sessionsWithLaps', () => {
  it('counts only the chosen sessions that hold a green lap', () => {
    const history = [{id: 'a'}, {id: 'b'}, {id: 'c'}, {id: 'old'}];
    const perSession = [
      {id: 'a', laps: [1, 2]},
      {id: 'b', laps: []},
      {id: 'c', laps: [3]},
      {id: 'old', laps: [4]},
    ];
    expect(
      sessionsWithLaps(history, perSession, ['a', 'b', 'c']).map(s => s.id),
    ).toEqual(['a', 'c']);
  });
});
