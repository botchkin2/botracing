import {describe, expect, it} from '@jest/globals';

import {
  distanceAtTime,
  gridStepM,
  panCursor,
  playStep,
  rebaseToWindow,
  type TimedGrid,
  timeAtDistance,
  windowRange,
} from './window';

// 1000 m: the first 500 m at 50 m/s (10 s), the rest at 25 m/s (20 s).
const ref: TimedGrid = (() => {
  const distanceM = Array.from({length: 201}, (_, i) => i * 5);
  const timeS = distanceM.map(d => (d <= 500 ? d / 50 : 10 + (d - 500) / 25));
  return {stepM: 5, distanceM, timeS};
})();

describe('time <-> distance on the reference', () => {
  it('round-trips', () => {
    expect(timeAtDistance(ref, 250)).toBeCloseTo(5);
    expect(timeAtDistance(ref, 750)).toBeCloseTo(20);
    expect(distanceAtTime(ref, 20)).toBeCloseTo(750);
    expect(distanceAtTime(ref, -1)).toBe(0);
    expect(distanceAtTime(ref, 99)).toBe(1000);
  });
});

describe('windowRange', () => {
  it('time mode widens on the fast part and tightens on the slow part', () => {
    const [a, b] = windowRange(ref, 250, 'time', 2);
    expect(b - a).toBeCloseTo(100);
    const [c, d] = windowRange(ref, 750, 'time', 2);
    expect(d - c).toBeCloseTo(50);
  });
  it('distance mode is fixed; null is the whole lap', () => {
    expect(windowRange(ref, 600, 'distance', 200)).toEqual([500, 700]);
    // Clamped at the line by shifting: still 200 m wide.
    expect(windowRange(ref, 30, 'distance', 200)).toEqual([0, 200]);
    expect(windowRange(ref, 990, 'distance', 200)).toEqual([800, 1000]);
    expect(windowRange(ref, 600, 'time', null)).toEqual([0, 1000]);
  });
});

describe('panCursor', () => {
  it('dragging left moves forward by the window fraction', () => {
    expect(panCursor(ref, 600, 'distance', 200, -100, 400)).toBeCloseTo(650);
    // 1/4 of a 2 s window at 25 m/s = 12.5 m
    expect(panCursor(ref, 750, 'time', 2, -100, 400)).toBeCloseTo(762.5);
  });
  it('clamps to the lap', () => {
    expect(panCursor(ref, 10, 'distance', 200, 400, 400)).toBe(0);
  });
});

describe('rebaseToWindow', () => {
  it('starts every lap at 0 on the left edge', () => {
    expect(rebaseToWindow([0, 0.1, 0.3, 0.2], 1)).toEqual([
      -0.1,
      0,
      expect.closeTo(0.2),
      expect.closeTo(0.1),
    ]);
  });
});

describe('gridStepM', () => {
  it('picks a nice step with room between lines', () => {
    expect(gridStepM(100, 358)).toBe(20);
    expect(gridStepM(1000, 358)).toBe(200);
  });
});

describe('playStep', () => {
  it('advances by rate and loops at the lap end', () => {
    expect(playStep(ref, 250, 1, 1)).toBeCloseTo(300);
    expect(playStep(ref, 250, 1, 0.5)).toBeCloseTo(275);
    // 990 m is 29.6 s; +1 s wraps to 0.6 s, which is 30 m at 50 m/s.
    expect(playStep(ref, 990, 1, 1)).toBeCloseTo(30);
  });
});
