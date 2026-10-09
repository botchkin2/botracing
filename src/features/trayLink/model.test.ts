import {describe, expect, it} from '@jest/globals';

import {callbackUrl, parseTrayLink} from './model';

const STATE = 'a'.repeat(22);
const CHALLENGE = 'b'.repeat(43);
const ok = {port: '51234', state: STATE, challenge: CHALLENGE};

describe('parseTrayLink', () => {
  it('accepts a port, a state and a challenge of the right shape', () => {
    expect(parseTrayLink(ok)).toEqual({
      port: 51234,
      state: STATE,
      challenge: CHALLENGE,
    });
  });

  it('takes only an integer port from 1024 to 65535', () => {
    for (const port of ['80', '1023', '65536', '0', '-1', '5e3', ' 5000', '']) {
      expect(parseTrayLink({...ok, port})).toBeNull();
    }
    expect(parseTrayLink({...ok, port: '1024'})?.port).toBe(1024);
    expect(parseTrayLink({...ok, port: '65535'})?.port).toBe(65535);
  });

  it('refuses a port that tries to carry a host', () => {
    for (const port of [
      '80@evil.com',
      '5000@evil.com',
      '5000.evil.com',
      '5000/evil',
      '5000:80',
      '//evil.com',
      'evil.com',
      '5000%40evil.com',
    ]) {
      expect(parseTrayLink({...ok, port})).toBeNull();
    }
  });

  it('refuses a state or challenge of the wrong length or alphabet', () => {
    expect(parseTrayLink({...ok, state: 'a'.repeat(21)})).toBeNull();
    expect(parseTrayLink({...ok, state: `${'a'.repeat(21)}!`})).toBeNull();
    expect(parseTrayLink({...ok, challenge: 'b'.repeat(44)})).toBeNull();
    expect(parseTrayLink({...ok, challenge: `${'b'.repeat(42)}/`})).toBeNull();
  });

  it('refuses a missing or repeated parameter', () => {
    expect(parseTrayLink({})).toBeNull();
    expect(parseTrayLink({...ok, state: undefined})).toBeNull();
    expect(parseTrayLink({...ok, port: ['5000', '6000']})).toBeNull();
  });
});

describe('callbackUrl', () => {
  const request = {port: 51234, state: STATE, challenge: CHALLENGE};

  it('always goes to this PC on the tray port, and only to /callback', () => {
    const url = new URL(callbackUrl(request, 'code-1_x'));
    expect(url.protocol).toBe('http:');
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).toBe('51234');
    expect(url.pathname).toBe('/callback');
    expect(url.searchParams.get('code')).toBe('code-1_x');
    expect(url.searchParams.get('state')).toBe(STATE);
  });

  it('cannot be bent to another host by the code', () => {
    const url = new URL(callbackUrl(request, '&state=x@evil.com/'));
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.searchParams.get('code')).toBe('&state=x@evil.com/');
    expect(url.searchParams.get('state')).toBe(STATE);
  });

  it('carries no token: only the code and the state', () => {
    const url = new URL(callbackUrl(request, 'c'));
    expect([...url.searchParams.keys()].sort()).toEqual(['code', 'state']);
  });
});
