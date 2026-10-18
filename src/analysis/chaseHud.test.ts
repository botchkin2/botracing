import {describe, expect, it} from '@jest/globals';
import {chaseHudNumbers, elevationWindow, slopeKind} from './chaseHud';

// 10 m of climb over a 1000 m lap (heights every 100 m), linear then back down.
const elev = [0, 2, 4, 6, 8, 10, 8, 6, 4, 2];

describe('chaseHudNumbers', () => {
  it('is empty without a profile or a position', () => {
    expect(chaseHudNumbers(null, 100, 1000)).toEqual({gradePct: null, altM: null});
    expect(chaseHudNumbers(elev, null, 1000)).toEqual({gradePct: null, altM: null});
  });
  it('reads grade and height above the lowest point', () => {
    const up = chaseHudNumbers(elev, 250, 1000);
    expect(up.gradePct).toBeCloseTo(2, 0); // 2 m per 100 m
    expect(up.altM).toBeCloseTo(5, 0);
    expect(chaseHudNumbers(elev, 750, 1000).gradePct).toBeCloseTo(-2, 0);
  });
});

describe('elevationWindow', () => {
  it('samples from behind to ahead of the car, the car at its own index', () => {
    const w = elevationWindow(elev, 500, 1000, 100, 500, 6);
    expect(w.heights).toHaveLength(7);
    expect(w.stepM).toBeCloseTo(100);
    expect(w.carIndex).toBe(1);
    expect(w.heights[1]).toBeCloseTo(10, 0); // at 500 m the road is at its top
  });
});

describe('slopeKind', () => {
  it('colours climbs, drops and level stretches', () => {
    expect(slopeKind(0.05)).toBe('up');
    expect(slopeKind(-0.05)).toBe('down');
    expect(slopeKind(0.01)).toBe('flat');
  });
});
