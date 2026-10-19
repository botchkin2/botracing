import {describe, expect, test} from '@jest/globals';

import {
  cornerScales,
  deltaScale,
  heightScale,
  lateralScale,
  MIN_HEIGHT_SPAN_M,
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

describe('cornerScales', () => {
  const lap = (
    comparable: boolean,
    speed: number[],
    delta: number[],
    edge: number[],
  ) => ({
    comparable,
    speedKph: speed,
    deltaS: delta,
    trackEdgeM: edge,
  });

  test('a non-comparable lap does not stretch any fitted scale (spike)', () => {
    const clean = cornerScales(
      [lap(true, [150, 170], [-0.1, 0.1], [4, 5]), lap(true, [160], [0], [4])],
      WIN,
      STEP,
    );
    const spiked = cornerScales(
      [
        lap(true, [150, 170], [-0.1, 0.1], [4, 5]),
        lap(true, [160], [0], [4]),
        lap(false, [999], [9], [99]),
      ],
      WIN,
      STEP,
    );
    expect(spiked).toEqual(clean);
  });

  test('with no comparable lap it fits all laps, not the default range', () => {
    const s = cornerScales(
      [lap(false, [200, 240], [-0.2, 0.2], [4, 5])],
      WIN,
      STEP,
    );
    expect(s.speed.hi).toBeGreaterThanOrEqual(240);
    expect(s.speed.lo).toBeLessThanOrEqual(200);
  });
});

describe('heightScale', () => {
  test('a flat stretch keeps a 5 m span centred on its height: noise is not a hill', () => {
    // 0.3 m of measurement wobble around 8.1 m.
    const s = heightScale([8.0, 8.3, 8.1, 8.2, 8.1], WIN, STEP);
    expect(MIN_HEIGHT_SPAN_M).toBe(5);
    expect(s.hi - s.lo).toBeGreaterThanOrEqual(MIN_HEIGHT_SPAN_M);
    // Centred: the middle of the scale is within a tick step of the height.
    expect(Math.abs((s.lo + s.hi) / 2 - 8.15)).toBeLessThanOrEqual(s.step);
    // The 0.3 m wobble is under 10 % of the scale's span.
    expect(0.3 / (s.hi - s.lo)).toBeLessThan(0.1);
  });

  test('a real climb is fitted to its own range, wider than the minimum', () => {
    const s = heightScale([0, 4, 9, 14, 20], WIN, STEP);
    expect(s.lo).toBeLessThanOrEqual(0);
    expect(s.hi).toBeGreaterThanOrEqual(20);
    expect(s.hi - s.lo).toBeLessThan(40);
  });

  test('reads only the window', () => {
    const s = heightScale([0, 0, 0, 0, 0, 100, 100], [0, 20], STEP);
    expect(s.hi).toBeLessThan(50);
  });
});
