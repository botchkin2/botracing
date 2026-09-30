import {describe, expect, it} from '@jest/globals';

import {type Kept, nextKept, sameKept} from './keptSession';

const open: Kept = {id: 's1', laps: 'a,b', hl: 'b', corner: null};

describe('nextKept', () => {
  it('remembers the open session with its selection', () => {
    expect(
      nextKept(null, {pathname: '/session/s1', id: 's1', laps: 'a,b', hl: 'b'}),
    ).toEqual(open);
  });

  it('keeps it on Plan and Settings', () => {
    expect(nextKept(open, {pathname: '/plan'})).toBe(open);
    expect(nextKept(open, {pathname: '/settings'})).toBe(open);
  });

  it('forgets it on Sessions, Tracks and a Track page', () => {
    for (const pathname of ['/', '/tracks', '/track/x'])
      expect(nextKept(open, {pathname})).toBeNull();
  });

  it('another session replaces it, without the old corner', () => {
    const t5 = {...open, corner: 5};
    expect(nextKept(t5, {pathname: '/session/s2', id: 's2'})).toEqual({
      id: 's2',
      laps: undefined,
      hl: undefined,
      corner: null,
    });
  });

  it('remembers the corner from the Corner page', () => {
    const next = nextKept(open, {
      pathname: '/session/s1/corner/5',
      id: 's1',
      n: '5',
      laps: 'a,b',
    });
    expect(next?.corner).toBe(5);
  });

  it('Corner T5 then Compare keeps T5', () => {
    const t5 = {...open, corner: 5};
    expect(
      nextKept(t5, {pathname: '/session/s1/compare', id: 's1'})?.corner,
    ).toBe(5);
  });

  it('a section open in Compare overrides the remembered corner', () => {
    const t5 = {...open, corner: 5};
    expect(
      nextKept(t5, {
        pathname: '/session/s1/compare',
        id: 's1',
        sectionCorner: 9,
      })?.corner,
    ).toBe(9);
  });

  it('forgets everything on Sessions (the close), and Plan with nothing kept stays empty', () => {
    expect(nextKept(open, {pathname: '/'})).toBeNull();
    expect(nextKept(null, {pathname: '/plan'})).toBeNull();
  });
});

describe('sameKept', () => {
  it('compares by value, so a settled render does not loop', () => {
    expect(sameKept({...open}, {...open})).toBe(true);
    expect(sameKept(open, {...open, corner: 3})).toBe(false);
    expect(sameKept(null, null)).toBe(true);
    expect(sameKept(open, null)).toBe(false);
  });
});
