import {describe, expect, it} from '@jest/globals';

import {consumeCustomToken} from './customTokenFragment';

function fakeWindow(hash: string, pathname = '/session/s1', search = '?t=5') {
  const replaced: string[] = [];
  return {
    replaced,
    win: {
      location: {pathname, search, hash},
      history: {
        replaceState: (_s: null, _t: string, url: string) => {
          replaced.push(url);
        },
      },
    },
  };
}

describe('consumeCustomToken', () => {
  it('takes the token and clears the fragment from the address', () => {
    const {win, replaced} = fakeWindow('#ct=abc.def.ghi');
    expect(consumeCustomToken(win)).toBe('abc.def.ghi');
    expect(replaced).toEqual(['/session/s1?t=5']);
  });

  it('keeps any other fragment parameters', () => {
    const {win, replaced} = fakeWindow('#x=1&ct=tok&y=2');
    expect(consumeCustomToken(win)).toBe('tok');
    expect(replaced).toEqual(['/session/s1?t=5#x=1&y=2']);
  });

  it('leaves the address alone when there is no token', () => {
    const {win, replaced} = fakeWindow('#x=1');
    expect(consumeCustomToken(win)).toBeNull();
    expect(replaced).toEqual([]);
    expect(consumeCustomToken(fakeWindow('').win)).toBeNull();
  });

  it('clears an empty token but signs nobody in', () => {
    const {win, replaced} = fakeWindow('#ct=');
    expect(consumeCustomToken(win)).toBeNull();
    expect(replaced).toEqual(['/session/s1?t=5']);
  });
});
