import {describe, expect, it, jest} from '@jest/globals';

import {seatTokenFromUrl, signInFromSeatLink} from './devSeatLink';

const tokenFor = (uid: string) => `h.${btoa(JSON.stringify({uid})).replace(/=+$/, '')}.s`;
const linkFor = (uid: string) => `botracing61://dev-seat?ct=${encodeURIComponent(tokenFor(uid))}`;

describe('seatTokenFromUrl', () => {
  it('takes the token of a seat-test link', () => {
    expect(seatTokenFromUrl(linkFor('seat-test'))).toBe(tokenFor('seat-test'));
  });
  it('refuses a token for anyone else, and any other link', () => {
    expect(seatTokenFromUrl(linkFor('someone-else'))).toBeNull();
    expect(seatTokenFromUrl('botracing61://session/abc')).toBeNull();
    expect(seatTokenFromUrl('https://botracing-61.web.app/?ct=x')).toBeNull();
    expect(seatTokenFromUrl('botracing61://dev-seat?x=1')).toBeNull();
    expect(seatTokenFromUrl('botracing61://dev-seat?ct=not-a-token')).toBeNull();
    expect(seatTokenFromUrl(null)).toBeNull();
  });
});

describe('signInFromSeatLink', () => {
  const deps = (uid: string | null) => ({
    signIn: jest.fn(async () => (uid === null ? null : {uid})),
    signOut: jest.fn(async () => {}),
  });
  it('signs in as seat-test', async () => {
    const d = deps('seat-test');
    expect(await signInFromSeatLink(linkFor('seat-test'), d)).toBe('signed-in');
    expect(d.signIn).toHaveBeenCalledWith(tokenFor('seat-test'));
  });
  it('ignores a link that is not a seat link, without signing in', async () => {
    const d = deps('seat-test');
    expect(await signInFromSeatLink('botracing61://other', d)).toBe('ignored');
    expect(d.signIn).not.toHaveBeenCalled();
  });
  it('signs back out when the person made is not seat-test', async () => {
    const d = deps('someone-else');
    expect(await signInFromSeatLink(linkFor('seat-test'), d)).toBe('refused');
    expect(d.signOut).toHaveBeenCalled();
  });
  it('reports a failed sign-in without throwing', async () => {
    const d = {signIn: jest.fn(async () => { throw new Error('x'); }), signOut: jest.fn(async () => {})};
    expect(await signInFromSeatLink(linkFor('seat-test'), d)).toBe('failed');
  });
});
