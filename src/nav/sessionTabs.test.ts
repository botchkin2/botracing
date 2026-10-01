import {describe, expect, it} from '@jest/globals';

import {sessionTabs} from './sessionTabs';

const labels = (sessionType: string, hasField: boolean) =>
  sessionTabs({sessionType, hasField}).map(t => t.label);

describe('sessionTabs', () => {
  it('a race session has all four, and the last is Race', () => {
    expect(labels('R', true)).toEqual(['Laps', 'Compare', 'Corner', 'Race']);
  });

  it('a race without a field keeps its Race tab, which says so', () => {
    expect(labels('R', false)).toEqual(['Laps', 'Compare', 'Corner', 'Race']);
  });

  it('practice and qualifying get a Field tab when the session has a field', () => {
    for (const type of ['P', 'Q'])
      expect(sessionTabs({sessionType: type, hasField: true})[3]).toEqual({
        key: 'race',
        label: 'Field',
      });
  });

  it('practice and qualifying without a field, and a session still loading, have no fourth tab', () => {
    expect(labels('P', false)).toEqual(['Laps', 'Compare', 'Corner']);
    expect(labels('Q', false)).toEqual(['Laps', 'Compare', 'Corner']);
    expect(sessionTabs(undefined).map(t => t.key)).toEqual([
      'session',
      'compare',
      'corner',
    ]);
  });

  it('takes the desktop Corner label', () => {
    expect(
      sessionTabs({sessionType: 'R', hasField: true}, 'Corner T5')[2].label,
    ).toBe('Corner T5');
  });
});
