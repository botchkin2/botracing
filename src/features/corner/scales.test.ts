import {describe, expect, test} from '@jest/globals';

import {
  deltaScale,
  lateralScale,
  pedalScale,
  speedScale,
  steeringScale,
  valuesInWindow,
} from './scales';

const WIN: [number, number] = [0, 20];
const STEP = 5;

describe('valuesInWindow', () => {
  test('takes the values by grid index, dropping the missing ones', () => {
    // window 5..15 m at 5 m steps is indices 1..3; index 1 is NaN
    const arr = [1, NaN, 3, 4, 5, 6, 7];
    expect(valuesInWindow([arr], [5, 15], STEP)).toEqual([3, 4]);
  });
});

describe('speedScale', () => {
  test('is fitted to the window, from zero up', () => {
    const s = speedScale([[100, 150, 180]], WIN, STEP);
    expect(s.lo).toBeLessThanOrEqual(100);
    expect(s.hi).toBeGreaterThanOrEqual(180);
    expect(s.ticks.length).toBeLessThanOrEqual(8);
  });

  test('ignores laps outside the window', () => {
    // the 999 sits past the window's last grid index (4)
    const s = speedScale([[100, 120, 130, 140, 150, 999]], [0, 20], STEP);
    expect(s.hi).toBeLessThan(999);
  });
});

describe('deltaScale', () => {
  test('is symmetric about zero, with signed labels', () => {
    const s = deltaScale([[-0.3, 0.2]], WIN, STEP);
    expect(s.lo).toBe(-s.hi);
    expect(s.ticks.some(t => t.v === 0 && t.label === '0.0 s')).toBe(true);
  });

  test('a flat delta at zero still straddles zero', () => {
    const s = deltaScale([[0, 0]], WIN, STEP);
    expect(s.lo).toBeLessThan(0);
    expect(s.hi).toBeGreaterThan(0);
  });
});

describe('fixed physical scales', () => {
  test('pedals run 0 to 100 % with 4 % room either end', () => {
    const s = pedalScale();
    expect([s.lo, s.hi]).toEqual([-4, 104]);
    expect(s.ticks.map(t => t.v)).toEqual([0, 25, 50, 75, 100]);
    expect(s.ticks[0].label).toBe('0 %');
  });

  test('steering is fixed at ±100 % of lock, whatever the lap', () => {
    const s = steeringScale();
    expect([s.lo, s.hi]).toEqual([-100, 100]);
  });
});

describe('lateralScale', () => {
  test('is symmetric, sized to the measured road edges in the window', () => {
    const s = lateralScale([[4.2, 5.1, 4.8]], WIN, STEP);
    expect(s.lo).toBe(-s.hi);
    expect(s.hi).toBeGreaterThanOrEqual(5.1);
  });
});
