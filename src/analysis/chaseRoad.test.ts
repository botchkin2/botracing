import {describe, expect, it} from '@jest/globals';

import {chaseRoad, roadGrade, roadHeight} from './chaseRoad';

describe('chaseRoad', () => {
  const ring = Array.from({length: 40}, (_, i) => ({
    x: 100 * Math.cos((i / 40) * Math.PI * 2),
    y: 100 * Math.sin((i / 40) * Math.PI * 2),
  }));
  it('takes measured half-widths and fills a missing side', () => {
    const left = ring.map(() => 6);
    const right = ring.map((_, i) => (i === 3 ? NaN : 5));
    const road = chaseRoad(ring, {stepM: 10, lengthM: 400, leftM: left, rightM: right}, 10, 400, null, 0);
    expect(road?.hl[0]).toBe(6);
    expect(road?.hr[3]).toBe(7);
    expect(road?.hr[4]).toBe(5);
    expect(road?.elev).toBeNull();
  });
  it('is null for a path too short to be a road', () => {
    expect(chaseRoad(ring.slice(0, 3), null, 10, 30, null, 0)).toBeNull();
  });
  it('keeps the profile with its own step and lap, and its lowest point', () => {
    const road = chaseRoad(ring, null, 10, 400, {stepM: 10, heightM: [3, -2, 5, 1, 0]}, 50)!;
    expect(road.elev).toEqual({stepM: 10, heightM: [3, -2, 5, 1, 0], lengthM: 50});
    expect(road.elevMin).toBe(-2);
  });
  it('has no profile without a lap length to read it on', () => {
    expect(chaseRoad(ring, null, 10, 400, {stepM: 10, heightM: [0, 1, 2, 3]}, 0)!.elev).toBeNull();
  });
});

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
