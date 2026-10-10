import {describe, expect, it} from '@jest/globals';

import {
  fillRateLPerS,
  REFUEL_L_PER_S,
  refuelMeasured,
  refuelS,
  refuelRateOf,
  refuelRateScope,
  refuelScope,
  refuelSecondsAt,
} from './refuel';

describe('refuel', () => {
  it('is measured on GT3 only', () => {
    expect(refuelMeasured('GT3')).toBe(true);
    expect(refuelMeasured('LMP2')).toBe(false);
    expect(refuelMeasured('Hyper')).toBe(false);
    expect(refuelMeasured('')).toBe(false);
    // Trimmed and case-blind.
    expect(refuelMeasured(' gt3 ')).toBe(true);
    expect(refuelS(34, 'gt3')).toBeCloseTo(10, 5);
  });

  it('is litres over the rate: the frame’s +33.2 L is 9.8 s and +50.0 L is 14.7 s', () => {
    expect(REFUEL_L_PER_S).toBe(3.4);
    expect(refuelS(33.2, 'GT3')).toBeCloseTo(9.76, 2);
    expect(refuelS(50, 'GT3')).toBeCloseTo(14.7, 1);
  });

  it('is null where the rate is not measured, and when nothing was added', () => {
    expect(refuelS(50, 'LMP2')).toBeNull();
    expect(refuelS(0, 'GT3')).toBeNull();
    expect(refuelS(-1, 'GT3')).toBeNull();
  });

  it('says where the rate comes from, only where it is measured', () => {
    expect(refuelScope('GT3')).toBe(
      'refuel at 3.4 L/s · GT3, measured on 5 stops',
    );
    expect(refuelScope('Hyper')).toBeNull();
  });
});

describe('fillRateLPerS', () => {
  // 20 Hz level held at 100 Hz: a rise every 5th sample.
  const ramp = (litres: number, perStep: number) => {
    const t: number[] = [];
    const fuel: number[] = [];
    let level = 50;
    for (let i = 0; i < 400; i++) {
      t.push(i / 100);
      if (i >= 100 && i % 5 === 0 && level < 50 + litres - 1e-9)
        level = Math.min(50 + litres, level + perStep);
      fuel.push(level);
    }
    return {t, fuel};
  };

  it('reads the pump rate from the rise, not the stop', () => {
    // 0.17 L every 0.05 s is 3.4 L/s; 24 steps add 4.08 L in 1.2 s.
    const {t, fuel} = ramp(4.08, 0.17);
    expect(fillRateLPerS(fuel, t, 0, 399)).toBeCloseTo(3.4, 1);
  });

  it('is null under a litre (sensor noise) or with nothing added', () => {
    const {t, fuel} = ramp(0.5, 0.17);
    expect(fillRateLPerS(fuel, t, 0, 399)).toBeNull();
    expect(fillRateLPerS([5, 5, 5], [0, 1, 2], 0, 2)).toBeNull();
  });

  it('ignores the level falling (fuel burnt) inside the window', () => {
    const {t, fuel} = ramp(4.08, 0.17);
    const burnt = fuel.map((v, i) => (i < 50 ? v + (50 - i) * 0.01 : v));
    expect(fillRateLPerS(burnt, t, 0, 399)).toBeCloseTo(3.4, 1);
  });
});

describe('refuelRateOf', () => {
  it('is the median of the measured fills, any class', () => {
    expect(refuelRateOf([3.37, null, 3.41, 3.2], 'LMP2')).toEqual({
      lPerS: 3.37,
      stops: 3,
      measured: true,
    });
  });

  it('falls back to the GT3 rate, and has none for an unmeasured class', () => {
    expect(refuelRateOf([null], 'GT3')).toEqual({
      lPerS: REFUEL_L_PER_S,
      stops: 5,
      measured: false,
    });
    expect(refuelRateOf([], 'Hyper')).toBeNull();
  });

  it('turns litres into seconds at the rate and names where it came from', () => {
    const r = refuelRateOf([3.4], 'GT3');
    expect(refuelSecondsAt(34, r)).toBeCloseTo(10, 5);
    expect(refuelSecondsAt(34, null)).toBeNull();
    expect(refuelRateScope(r)).toBe(
      'refuel at 3.4 L/s · your 1 stop here',
    );
    expect(refuelRateScope(refuelRateOf([], 'GT3'))).toBe(
      'refuel at 3.4 L/s · GT3, measured on 5 stops',
    );
  });
});
