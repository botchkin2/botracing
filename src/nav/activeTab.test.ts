import {describe, expect, it} from '@jest/globals';

import {destinationOf, sessionTabOf} from './activeTab';

describe('sessionTabOf', () => {
  it('names each session workspace', () => {
    expect(sessionTabOf('/session/abc')).toBe('session');
    expect(sessionTabOf('/session/abc/compare')).toBe('compare');
    expect(sessionTabOf('/session/abc/race')).toBe('race');
    expect(sessionTabOf('/session/abc/corner/3')).toBe('corner');
  });

  it('is null off the session routes', () => {
    for (const path of ['/', '/plan', '/tracks', '/track/x', '/settings'])
      expect(sessionTabOf(path)).toBeNull();
  });
});

describe('destinationOf', () => {
  it('lights Plan and Settings on their own pages', () => {
    expect(destinationOf('/plan')).toBe('plan');
    expect(destinationOf('/settings')).toBe('settings');
  });

  it('keeps Sessions lit for sessions, Tracks and Track pages', () => {
    for (const path of [
      '/',
      '/session/abc',
      '/session/abc/race',
      '/tracks',
      '/track/x',
    ])
      expect(destinationOf(path)).toBe('sessions');
  });
});
