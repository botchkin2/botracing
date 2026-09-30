import {describe, expect, it} from '@jest/globals';

import {tabTarget} from './tabTarget';

describe('tabTarget', () => {
  it('opens the tab for the selected session', () => {
    for (const tab of ['session', 'compare', 'race', 'corner'] as const)
      expect(tabTarget(tab, 'abc')).toEqual({kind: tab, sessionId: 'abc'});
  });

  it('goes to Sessions when no session is selected', () => {
    for (const tab of ['session', 'compare', 'race', 'corner'] as const)
      expect(tabTarget(tab, null)).toEqual({kind: 'sessions'});
  });

  it('treats an empty session id as none', () => {
    expect(tabTarget('compare', '')).toEqual({kind: 'sessions'});
  });

  it('Tracks and Plan never need a session', () => {
    expect(tabTarget('tracks', null)).toEqual({kind: 'tracks'});
    expect(tabTarget('tracks', 'abc')).toEqual({kind: 'tracks'});
    expect(tabTarget('plan', null)).toEqual({kind: 'plan'});
    expect(tabTarget('plan', 'abc')).toEqual({kind: 'plan'});
  });
});
