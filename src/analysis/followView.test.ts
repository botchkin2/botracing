import {describe, expect, it} from '@jest/globals';

import {
  brakeOnsetsM,
  FOLLOW_ANCHOR_Y,
  followProject,
  followScale,
  followVisibleM,
  headingRad,
} from './followView';

describe('followVisibleM', () => {
  it('is 0.95 × the window span', () => {
    expect(followVisibleM(200)).toBeCloseTo(190);
  });
  it('holds to 50–360 m', () => {
    expect(followVisibleM(20)).toBe(50);
    expect(followVisibleM(1000)).toBe(360);
  });
  it('uses 260 m for a whole-lap window', () => {
    expect(followVisibleM(null)).toBe(260);
  });
});

describe('followProject', () => {
  const view = {
    centre: {x: 100, y: 50},
    headingRad: 0,
    visibleM: 100,
    width: 200,
    height: 200,
  };

  it('puts the centre at mid-width, 64% height', () => {
    const p = followProject(view)(view.centre);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(200 * FOLLOW_ANCHOR_Y);
  });

  it('points the heading up the screen', () => {
    // Heading east: 10 m east of the centre is 10 m straight up.
    const p = followProject(view)({x: 110, y: 50});
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(128 - 10 * followScale(view));
  });

  it('puts the left of the car on the left of the screen', () => {
    // Heading north: west is left.
    const north = {...view, headingRad: Math.PI / 2};
    const p = followProject(north)({x: 90, y: 50});
    expect(p.x).toBeLessThan(100);
    expect(p.y).toBeCloseTo(128);
  });
});

describe('headingRad', () => {
  it('is atan2 of the step', () => {
    expect(headingRad({x: 0, y: 0}, {x: 0, y: 5})).toBeCloseTo(Math.PI / 2);
  });
});

describe('brakeOnsetsM', () => {
  const distanceM = [0, 5, 10, 15, 20, 25, 30];
  const brakePct = [0, 0, 60, 80, 0, 5, 40];

  it('finds each rise above the threshold', () => {
    expect(brakeOnsetsM(distanceM, brakePct, 0, 30)).toEqual([10, 30]);
  });
  it('only inside the range', () => {
    expect(brakeOnsetsM(distanceM, brakePct, 12, 30)).toEqual([30]);
  });
  it('ignores a trace that starts braked', () => {
    expect(brakeOnsetsM([0, 5], [50, 60], 0, 5)).toEqual([]);
  });
});
