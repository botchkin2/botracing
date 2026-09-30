import {describe, expect, it} from '@jest/globals';

import {REFUEL_L_PER_S, refuelMeasured, refuelS, refuelScope} from './refuel';

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
