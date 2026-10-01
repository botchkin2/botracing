import {describe, expect, it} from '@jest/globals';

import {sessionTabs} from './sessionTabs';

describe('sessionTabs', () => {
  it('a race session has all four', () => {
    expect(sessionTabs('R').map(t => t.label)).toEqual([
      'Laps',
      'Compare',
      'Corner',
      'Race',
    ]);
  });

  it('practice, qualifying and a session still loading have no Race', () => {
    for (const type of ['P', 'Q', undefined])
      expect(sessionTabs(type).map(t => t.key)).toEqual([
        'session',
        'compare',
        'corner',
      ]);
  });

  it('takes the desktop Corner label', () => {
    expect(sessionTabs('R', 'Corner T5')[2].label).toBe('Corner T5');
  });
});
