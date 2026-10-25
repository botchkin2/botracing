import {describe, expect, it} from '@jest/globals';

import {fadedNow} from './fadeRule';

const car = (over: Partial<Parameters<typeof fadedNow>[0]> = {}) => ({
  followed: false,
  ghosts: false,
  wasFaded: false,
  distM: 20,
  reachM: 10,
  ...over,
});

describe('fadedNow', () => {
  it('a car in front of the followed one fades, one behind it does not', () => {
    expect(fadedNow(car({distM: 5}))).toBe(true);
    expect(fadedNow(car({distM: 20}))).toBe(false);
  });

  it('a faded car stays faded inside the band, so it does not flicker', () => {
    expect(fadedNow(car({distM: 10.5, wasFaded: true}))).toBe(true);
    expect(fadedNow(car({distM: 10.5, wasFaded: false}))).toBe(false);
    expect(fadedNow(car({distM: 12, wasFaded: true}))).toBe(false);
  });

  it('with ghosts every car but the followed one is see-through, near or far', () => {
    expect(fadedNow(car({ghosts: true, distM: 200}))).toBe(true);
    expect(fadedNow(car({ghosts: true, distM: 5}))).toBe(true);
    expect(fadedNow(car({ghosts: true, followed: true}))).toBe(false);
  });

  it('the followed car is never see-through', () => {
    expect(fadedNow(car({followed: true, distM: 0}))).toBe(false);
  });
});
