import {describe, expect, it} from '@jest/globals';
import {chaseHeading, stepTravel} from './chaseHeading';

const base = {tangent: 0, travel: 0, speedKmh: 120, onRoad: true};

describe('chaseHeading', () => {
  it('keeps the stored yaw where it agrees with the road', () => {
    expect(chaseHeading({...base, gameYaw: 0.2})).toBe(0.2);
  });
  it('replaces a flipped yaw on a moving car with its travel', () => {
    expect(chaseHeading({...base, gameYaw: Math.PI, travel: 0.1})).toBe(0.1);
  });
  it('replaces a flipped yaw on a slow car with the road tangent', () => {
    expect(chaseHeading({...base, gameYaw: Math.PI, travel: 0.1, speedKmh: 3, tangent: 0.05})).toBe(0.05);
  });
  it('keeps the yaw of a car off the road (pit, grid) whatever the road says', () => {
    expect(chaseHeading({...base, gameYaw: Math.PI, onRoad: false})).toBe(Math.PI);
  });
  it('keeps a yaw that disagrees with the road but matches the car travelling that way', () => {
    expect(chaseHeading({...base, gameYaw: Math.PI, travel: Math.PI - 0.1})).toBe(Math.PI);
  });
  it('keeps the yaw of a spinning car: 100 degrees from the road and the travel is a spin, not a flip', () => {
    const yaw = (100 * Math.PI) / 180;
    expect(chaseHeading({...base, gameYaw: yaw, tangent: 0, travel: 0})).toBe(yaw);
  });
  it('falls back to the road, then zero, without a yaw', () => {
    expect(chaseHeading({...base, gameYaw: null, travel: null, tangent: 0.4})).toBe(0.4);
    expect(chaseHeading({gameYaw: null, tangent: null, travel: null, speedKmh: 0, onRoad: false})).toBe(0);
  });
});

describe('stepTravel', () => {
  it('starts at the first bearing and moves halfway to the next', () => {
    const a = stepTravel(null, 1, 0);
    expect(a).toBe(0);
    expect(stepTravel(a, 0, 1)).toBeCloseTo(Math.PI / 4);
  });
  it('holds through a tiny move and forgets a jump', () => {
    expect(stepTravel(0.3, 0.1, 0.1)).toBe(0.3);
    expect(stepTravel(0.3, 100, 0)).toBeNull();
  });
});
