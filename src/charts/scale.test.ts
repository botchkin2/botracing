import {describe, expect, test} from '@jest/globals';

import {
  clampToScale,
  fitScale,
  fixedScale,
  isClipped,
  MAX_TICKS,
  niceStep,
} from './scale';

const labels = (s: {ticks: {label: string}[]}) => s.ticks.map(t => t.label);

describe('niceStep', () => {
  test('walks 1-2-5 and takes the first that fits', () => {
    // span 20: 1 gives 20 ticks, 2 gives 10, 5 gives 4 (fits 8)
    expect(niceStep(20)).toBe(5);
  });

  test('uses tenths and hundredths in the same sequence', () => {
    // span 0.6: 0.1 gives 6 intervals, fits
    expect(niceStep(0.6)).toBe(0.1);
    expect(niceStep(0.09)).toBe(0.02);
  });

  test('a finer maxTicks takes a coarser step', () => {
    expect(niceStep(20, 4)).toBe(10);
  });
});

describe('fixedScale', () => {
  test('is the range it was given, with its ticks', () => {
    const s = fixedScale(0, 100, 25);
    expect([s.lo, s.hi, s.step]).toEqual([0, 100, 25]);
    expect(labels(s)).toEqual(['0', '25', '50', '75', '100']);
  });
});

describe('fitScale', () => {
  test('covers the values, rounded out to whole steps', () => {
    const s = fitScale([-0.42, 0.9], {symmetric: false});
    expect(s.lo).toBeLessThanOrEqual(-0.42);
    expect(s.hi).toBeGreaterThanOrEqual(0.9);
    expect(s.ticks.length).toBeLessThanOrEqual(MAX_TICKS);
  });

  test('the tick count stays within maxTicks after the range rounds out', () => {
    // wedge #3546: [0.9, 8.1] rounded to 0..9 at step 1 gives 10 ticks; the step must rise
    const s = fitScale([0.9, 8.1], {symmetric: false});
    expect(s.ticks.length).toBeLessThanOrEqual(MAX_TICKS);
    expect(s.lo).toBeLessThanOrEqual(0.9);
    expect(s.hi).toBeGreaterThanOrEqual(8.1);
  });

  test('a flat symmetric set at zero is centred on zero', () => {
    // wedge #3546: [0] symmetric gave [0, 0.1]; it must straddle zero
    const s = fitScale([0], {symmetric: true});
    expect(s.lo).toBeLessThan(0);
    expect(s.hi).toBeGreaterThan(0);
    expect(s.lo).toBe(-s.hi);
  });

  test('a symmetric scale is centred on zero for differences', () => {
    const s = fitScale([-0.3, 0.1], {symmetric: true});
    expect(s.lo).toBe(-s.hi);
    expect(s.hi).toBeGreaterThanOrEqual(0.3);
  });

  test('a flat asymmetric set still gets a step of room', () => {
    const s = fitScale([0.3], {symmetric: false});
    expect(s.hi - s.lo).toBeGreaterThanOrEqual(s.step);
    expect(s.lo).toBeLessThanOrEqual(0.3);
    expect(s.hi).toBeGreaterThanOrEqual(0.3);
  });

  test('ticks carry their values and labels', () => {
    const s = fitScale([0, 20], {symmetric: false});
    expect(s.step).toBe(5);
    expect(s.ticks.map(t => t.v)).toEqual([0, 5, 10, 15, 20]);
    expect(labels(s)).toEqual(['0', '5', '10', '15', '20']);
  });

  test('labels show the decimals the step needs', () => {
    expect(labels(fitScale([0, 0.4], {symmetric: false}))).toEqual([
      '0.0',
      '0.1',
      '0.2',
      '0.3',
      '0.4',
    ]);
  });

  test('a wide range takes a coarser 1-2-5 step, never more than eight ticks', () => {
    const s = fitScale([0, 20], {symmetric: false});
    expect(s.ticks.length).toBeLessThanOrEqual(MAX_TICKS);
  });

  test('ignores values that are not finite', () => {
    expect(fitScale([NaN, 0.2, Infinity, 0.4], {symmetric: false})).toEqual(
      fitScale([0.2, 0.4], {symmetric: false}),
    );
  });

  test('an empty set gets a unit range either side of zero, never zero height', () => {
    const s = fitScale([], {symmetric: false});
    expect([s.lo, s.hi]).toEqual([-1, 1]);
    expect(s.ticks.length).toBeLessThanOrEqual(MAX_TICKS);
  });

  test('the same values give the same scale', () => {
    const values = [0.11, -0.07, 0.4];
    expect(fitScale(values, {symmetric: false})).toEqual(
      fitScale(values, {symmetric: false}),
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
