import {describe, expect, it} from '@jest/globals';

import {roadGrade, roadHeight} from './chaseRoad';

describe('roadHeight', () => {
  const elev = {stepM: 10, heightM: [0, 10, 20, 30, 40], lengthM: 45};
  it('scales the road lap onto the profile lap (one lap, two measures) and wraps', () => {
    // the road measured the lap as 90 m: its 30 m is the profile's 15 m, its 85 m the profile's 42.5 m
    expect(roadHeight(elev, 30, 90)).toBeCloseTo(15);
    expect(roadHeight(elev, 85, 90)).toBeCloseTo(20);
  });
  it('reads grade as rise over run on the profile metres, + uphill', () => {
    expect(roadGrade(elev, 20, 45, 10)).toBeCloseTo(1);
    expect(roadGrade(elev, 42.5, 45, 4)).toBeCloseTo(-8);
  });
});
