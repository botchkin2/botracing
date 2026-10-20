import {describe, expect, it} from '@jest/globals';

import {allowsNavigation, EMBED_ORIGIN, embedUrl} from './embed3d';

describe('embedUrl', () => {
  it('is the race page of the session, in the embed, at the selection, with the token in the fragment only', () => {
    const url = embedUrl(EMBED_ORIGIN, 'abc123', {laps: '4,5', t: '1800', hl: undefined, c: ''}, 'tok.en+/=');
    expect(url).toBe('https://botracing-61.web.app/session/abc123/race?embed=3d&laps=4%2C5&t=1800#ct=tok.en%2B%2F%3D');
    // nothing secret before the '#': a server, a log and a referrer never see the token
    expect(url.split('#')[0]).not.toContain('tok');
  });
  it('carries only the selection, never anything else it was given', () => {
    const url = embedUrl(EMBED_ORIGIN, 'a', {laps: '1', evil: 'x'} as never, 't');
    expect(url).not.toContain('evil');
  });
});

describe('allowsNavigation', () => {
  it('allows the hosting origin and a blank page, refuses everything else', () => {
    expect(allowsNavigation(EMBED_ORIGIN, `${EMBED_ORIGIN}/session/a/race?embed=3d`)).toBe(true);
    expect(allowsNavigation(EMBED_ORIGIN, EMBED_ORIGIN)).toBe(true);
    expect(allowsNavigation(EMBED_ORIGIN, 'about:blank')).toBe(true);
    expect(allowsNavigation(EMBED_ORIGIN, 'https://evil.example/')).toBe(false);
    // a look-alike host that merely starts with the origin text
    expect(allowsNavigation(EMBED_ORIGIN, `${EMBED_ORIGIN}.evil.example/x`)).toBe(false);
    expect(allowsNavigation(EMBED_ORIGIN, 'http://botracing-61.web.app/x')).toBe(false);
  });
});
