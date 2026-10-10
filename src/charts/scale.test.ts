import {describe, expect, test} from '@jest/globals';

import {clampToScale, fixedScale, isClipped, timeScale} from './scale';

describe('fixedScale', () => {
  test('is the range it was given, whatever the data', () => {
    expect(fixedScale(0, 100, 25)).toEqual({lo: 0, hi: 100, step: 25});
  });
});

describe('timeScale', () => {
  test('covers the values, rounded out to a nice step', () => {
    // span 1.32 s: 0.1 would need 14 ticks, 0.25 fits in 6
    expect(timeScale([-0.42, 0.9], {symmetric: false})).toEqual({
      lo: -0.5,
      hi: 1,
      step: 0.25,
    });
  });

  test('a symmetric scale centres on zero for differences', () => {
    expect(timeScale([-0.3, 0.1], {symmetric: true})).toEqual({
      lo: -0.3,
      hi: 0.3,
      step: 0.1,
    });
  });

  test('ignores values that are not finite', () => {
    expect(timeScale([NaN, 0.2, Infinity, 0.4], {symmetric: false})).toEqual(
      timeScale([0.2, 0.4], {symmetric: false}),
    );
  });

  test('an empty set gets the default, never a zero-height scale', () => {
    expect(timeScale([], {symmetric: false})).toEqual({
      lo: -0.5,
      hi: 0.5,
      step: 0.25,
    });
  });

  test('one lap at zero still gets a step of room', () => {
    const s = timeScale([0], {symmetric: false});
    expect(s.hi - s.lo).toBeGreaterThanOrEqual(s.step);
    expect(s.lo).toBeLessThanOrEqual(0);
    expect(s.hi).toBeGreaterThanOrEqual(0);
  });

  test('a wide set takes a coarser step to stay within eight steps', () => {
    // span 6 s: 0.5 s steps give 12 ticks, 1 s steps give 6
    expect(timeScale([0, 6], {symmetric: false}).step).toBe(1);
  });

  test('the same values give the same scale (no hidden state)', () => {
    const values = [0.11, -0.07, 0.4];
    expect(timeScale(values, {symmetric: false})).toEqual(
      timeScale(values, {symmetric: false}),
    );
  });
});

describe('clipping', () => {
  const s = fixedScale(-100, 100, 50);

  test('a value inside the scale is not clipped', () => {
    expect(isClipped(99, s)).toBe(false);
    expect(isClipped(-100, s)).toBe(false);
  });

  test('a value outside the scale is clipped, and held to the edge', () => {
    expect(isClipped(130, s)).toBe(true);
    expect(clampToScale(130, s)).toBe(100);
    expect(clampToScale(-130, s)).toBe(-100);
  });

  test('a missing value is neither clipped nor drawn', () => {
    expect(isClipped(NaN, s)).toBe(false);
    expect(clampToScale(NaN, s)).toBeNaN();
  });
});
