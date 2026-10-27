import {describe, expect, it} from '@jest/globals';

import {
  noteUrl,
  screenName,
  sessionIdOf,
  trayVersionOf,
  versionText,
} from './noteLink';

const facts = {
  screen: 'Race',
  sessionId: '0ac2647cb5bf2640',
  appVersion: '1.0.18',
  trayVersion: '0.1.18',
  device: 'phone' as const,
};

describe('noteUrl', () => {
  it('opens the his-note issue form on the pit-wall repo with the facts and no note text', () => {
    const url = new URL(noteUrl(facts));
    expect(url.origin + url.pathname).toBe(
      'https://github.com/botchkin2/pit-wall/issues/new',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      template: 'his-note.yml',
      title: 'Note: Race',
      screen: 'Race',
      session: '0ac2647cb5bf2640',
      version: 'App 1.0.18 · tray 0.1.18',
      device: 'phone',
    });
    expect(url.searchParams.has('note')).toBe(false);
  });

  it('leaves the session out when there is none', () => {
    const url = new URL(noteUrl({...facts, screen: 'Plan', sessionId: null}));
    expect(url.searchParams.has('session')).toBe(false);
    expect(url.searchParams.get('title')).toBe('Note: Plan');
  });

  it('is well under the length a URL can have', () => {
    expect(noteUrl(facts).length).toBeLessThan(400);
  });

  it('carries no uid or token, only the five facts', () => {
    const url = new URL(noteUrl(facts));
    expect([...url.searchParams.keys()].sort()).toEqual(
      ['device', 'screen', 'session', 'template', 'title', 'version'].sort(),
    );
  });
});

describe('screenName and sessionIdOf', () => {
  it('names each screen without an id', () => {
    expect(screenName('/')).toBe('Sessions');
    expect(screenName('/plan')).toBe('Plan');
    expect(screenName('/settings')).toBe('Settings');
    expect(screenName('/tracks')).toBe('Tracks');
    expect(screenName('/track/lmu-spa')).toBe('Track');
    expect(screenName('/session/abc')).toBe('Session');
    expect(screenName('/session/abc/compare')).toBe('Compare');
    expect(screenName('/session/abc/race')).toBe('Race');
    expect(screenName('/session/abc/corner/3')).toBe('Corner');
    expect(screenName('/somewhere/else')).toBe('App');
  });

  it('reads the session id from a session path only', () => {
    expect(sessionIdOf('/session/abc/race')).toBe('abc');
    expect(sessionIdOf('/session/abc')).toBe('abc');
    expect(sessionIdOf('/plan')).toBeNull();
    expect(sessionIdOf('/track/abc')).toBeNull();
  });
});

describe('versions', () => {
  it('says what it does not know', () => {
    expect(versionText('1.0.18', null)).toBe('App 1.0.18 · tray unknown');
    expect(versionText('', '0.1.18')).toBe('App unknown · tray 0.1.18');
  });

  it('takes the tray version of the PC heard from last', () => {
    expect(
      trayVersionOf([
        {version: '0.1.16', lastSeenAt: 100},
        {version: '0.1.18', lastSeenAt: 300},
        {version: '', lastSeenAt: 900},
      ]),
    ).toBe('0.1.18');
    expect(trayVersionOf([])).toBeNull();
    expect(trayVersionOf([{version: '', lastSeenAt: 1}])).toBeNull();
  });
});
