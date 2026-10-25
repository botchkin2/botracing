import {describe, expect, it} from '@jest/globals';

import {ABSENT} from './field';
import fixtures from './__fixtures__/placeBlips.json';
import {countBlips, steadyPlace} from './placeBlips';

const p = (...v: number[]) => Int16Array.from(v);
const list = (a: Int16Array) => Array.from(a);

describe('steadyPlace: the game place without its blips', () => {
  it('a departure that is back within N updates takes the place it left', () => {
    expect(list(steadyPlace(p(3, 3, 9, 3, 3), 3))).toEqual([3, 3, 3, 3, 3]);
    expect(list(steadyPlace(p(3, 3, 9, 9, 9, 3, 3), 3))).toEqual([3, 3, 3, 3, 3, 3, 3]);
  });

  it('a blip of several places goes as one (a car that read P1, then P9, on its way back to P2)', () => {
    expect(list(steadyPlace(p(2, 2, 1, 1, 9, 2, 2), 3))).toEqual([2, 2, 2, 2, 2, 2, 2]);
    expect(list(steadyPlace(p(2, 2, 1, 1, 9, 9, 2, 2), 3))).toEqual([2, 2, 1, 1, 9, 9, 2, 2]);
  });

  it('a change that holds longer than N is a real overtake and stays', () => {
    expect(list(steadyPlace(p(3, 3, 4, 4, 4, 4, 3, 3), 3))).toEqual([3, 3, 4, 4, 4, 4, 3, 3]);
    expect(list(steadyPlace(p(3, 3, 4, 4, 4, 4, 4, 4), 3))).toEqual([3, 3, 4, 4, 4, 4, 4, 4]);
  });

  it('a different place after the run is a move, not a blip', () => {
    expect(list(steadyPlace(p(3, 3, 9, 4, 4), 3))).toEqual([3, 3, 9, 4, 4]);
  });

  it('a chain of one-update swaps settles on one place', () => {
    expect(list(steadyPlace(p(7, 7, 6, 7, 6, 7, 7), 3))).toEqual([7, 7, 7, 7, 7, 7, 7]);
    // the neighbour of a swapping pair reads the mirror image and settles the other way
    expect(list(steadyPlace(p(6, 6, 7, 6, 7, 6, 6), 3))).toEqual([6, 6, 6, 6, 6, 6, 6]);
  });

  it('a run at the start or the end has one neighbour and is kept', () => {
    expect(list(steadyPlace(p(9, 3, 3, 3), 3))).toEqual([9, 3, 3, 3]);
    expect(list(steadyPlace(p(3, 3, 3, 9), 3))).toEqual([3, 3, 3, 9]);
    expect(list(steadyPlace(p(9), 3))).toEqual([9]);
    expect(list(steadyPlace(p(), 3))).toEqual([]);
  });

  it('absent is never filled and never a neighbour', () => {
    expect(list(steadyPlace(p(3, ABSENT, 3), 3))).toEqual([3, ABSENT, 3]);
    expect(list(steadyPlace(p(ABSENT, 3, ABSENT), 3))).toEqual([ABSENT, 3, ABSENT]);
    expect(list(steadyPlace(p(3, 4, ABSENT, ABSENT, 4), 3))).toEqual([3, 4, ABSENT, ABSENT, 4]);
    expect(list(steadyPlace(p(3, 9, ABSENT, 3), 3))).toEqual([3, 9, ABSENT, 3]);
  });

  it('does not change its input, and leaves a steady series alone', () => {
    const a = p(3, 9, 3, 4, 4, 4, 4, 5);
    const copy = list(a);
    steadyPlace(a, 3);
    expect(list(a)).toEqual(copy);
    const steady = p(1, 1, 2, 2, 2, 2, 3, 3, 3, 3);
    expect(list(steadyPlace(steady, 3))).toEqual(list(steady));
  });

  it('is idempotent', () => {
    const a = p(7, 7, 6, 7, 6, 7, 7, 8, 8, 8, 8, 5, 8, 8);
    const once = steadyPlace(a, 3);
    expect(list(steadyPlace(once, 3))).toEqual(list(once));
  });

  it('only ever changes a tick that sits between two equal places at most N updates apart', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let round = 0; round < 50; round++) {
      const a = Int16Array.from({length: 60}, () => (rnd() < 0.1 ? ABSENT : 1 + Math.floor(rnd() * 4)));
      const b = steadyPlace(a, 3);
      for (let u = 0; u < a.length; u++) {
        if (a[u] === b[u]) continue;
        expect(a[u]).not.toBe(ABSENT);
        expect(b[u]).not.toBe(ABSENT);
      }
      expect(countBlips(b, 5)).toBeLessThanOrEqual(countBlips(a, 5));
    }
  });
});

describe('real series from the Sebring races (53128f6f, 73c538c3)', () => {
  it('the pole car at the green read P9 for two updates and is P1 throughout', () => {
    const raw = Int16Array.from(fixtures.oct21Car1AtGreen.place);
    expect(Array.from(raw)).toContain(9);
    expect(new Set(steadyPlace(raw, 3))).toEqual(new Set([1]));
  });

  it('the leader read P20 for one update at a mid-race line crossing and is P1 throughout', () => {
    const raw = Int16Array.from(fixtures.oct22Car0LineCrossing.place);
    expect(Array.from(raw)).toContain(20);
    expect(new Set(steadyPlace(raw, 3))).toEqual(new Set([1]));
  });
});

describe('countBlips', () => {
  it('counts a place that changes and comes back within the window', () => {
    expect(countBlips(p(3, 9, 3), 5)).toBe(1);
    expect(countBlips(p(3, 9, 9, 3), 5)).toBe(1);
    expect(countBlips(p(3, 4, 4, 4, 4, 4, 4, 3), 5)).toBe(0);
    expect(countBlips(p(3, 3, 3), 5)).toBe(0);
    expect(countBlips(p(3, ABSENT, 3), 5)).toBe(0);
  });
});
