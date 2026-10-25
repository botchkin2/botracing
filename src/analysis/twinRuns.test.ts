import {describe, expect, it} from '@jest/globals';

import {groupTwins, TWIN_WINDOW_S} from './twinRuns';

const s = (id: string, startedAt: string, trackCar = 'sebring|911') => ({
  id,
  startedAt,
  trackCar,
});

describe('groupTwins', () => {
  it('groups the triple, and 682524ed + 9b96efed, one group each, in start order', () => {
    const groups = groupTwins([
      s('c7ae92b3', '2026-10-15T01:09:50Z'),
      s('32c9d386', '2026-10-15T01:09:00Z'),
      s('7e812df9', '2026-10-15T01:09:20Z'),
      s('682524ed', '2026-10-14T00:25:05Z', 'silverstone|911'),
      s('9b96efed', '2026-10-14T00:25:50Z', 'silverstone|911'),
    ]);
    expect(groups.map(g => g.map(x => x.id))).toEqual([
      ['682524ed', '9b96efed'],
      ['32c9d386', '7e812df9', 'c7ae92b3'],
    ]);
  });

  it('sessions a minute and a half apart, or of another car, are separate runs', () => {
    expect(
      groupTwins([
        s('a', '2026-10-15T01:09:00Z'),
        s('b', '2026-10-15T01:10:30Z'),
        s('c', '2026-10-15T01:09:10Z', 'sebring|other'),
      ]),
    ).toHaveLength(3);
  });

  it('the window is closed at TWIN_WINDOW_S and open past it', () => {
    const t0 = Date.parse('2026-10-15T01:00:00Z');
    const at = (sec: number) => new Date(t0 + sec * 1000).toISOString();
    expect(groupTwins([s('a', at(0)), s('b', at(TWIN_WINDOW_S))])).toHaveLength(
      1,
    );
    expect(
      groupTwins([s('a', at(0)), s('b', at(TWIN_WINDOW_S + 1))]),
    ).toHaveLength(2);
  });
});
