import {describe, expect, it} from '@jest/globals';

import {followStep, newFollow, type FollowCar} from './chaseFollow';

// a car doing 50 m/s round a 100 m radius circle, body along its travel
const lap = (t: number): FollowCar => {
  const a = (50 / 100) * t;
  return {x: 100 * Math.cos(a), y: 100 * Math.sin(a), z: 0, heading: a + Math.PI / 2, travel: a + Math.PI / 2, v: 50};
};

function run(fps: number, rate = 1, seconds = 6) {
  const st = newFollow();
  const out: {dist: number; offAxis: number}[] = [];
  const dt = 1 / fps;
  for (let t = 0; t < seconds; t += dt) {
    const car = lap(t * rate);
    const v = followStep(st, car, dt, rate, 7, 2.2, false);
    const dist = Math.hypot(car.x - v.camX, car.y - v.camY);
    // angle between the camera's view of the car and the car's own direction: how far round the corner the car is seen
    const seen = Math.atan2(car.y - v.camY, car.x - v.camX);
    out.push({dist, offAxis: Math.abs(Math.atan2(Math.sin(seen - car.heading), Math.cos(seen - car.heading)))});
  }
  return out;
}

describe('followStep', () => {
  it('holds the camera exactly its distance behind the car, frame after frame', () => {
    for (const d of run(60)) expect(d.dist).toBeCloseTo(7, 9);
  });
  it('swings round a steady bend a steady few degrees behind the car, not away from it', () => {
    const settled = run(60).slice(120);
    // a time constant of 0.3 s on a 0.5 rad/s turn trails by tau x rate = 0.15 rad (8.6 deg)
    for (const d of settled) expect(d.offAxis * (180 / Math.PI)).toBeLessThan(10);
  });
  it('gives the same view at 30 and 144 frames per second', () => {
    const a = run(30).at(-1)!;
    const b = run(144).at(-1)!;
    expect(Math.abs(a.offAxis - b.offAxis)).toBeLessThan(0.01); // radians: the held sample differs by half a frame
  });
  it('keeps up at 4x: the swing is four times quicker, so the angle off axis is the same as at 1x', () => {
    const one = run(60, 1).at(-1)!.offAxis;
    const four = run(60, 4, 6 / 4).at(-1)!.offAxis;
    expect(four).toBeCloseTo(one, 1);
  });
  it('snaps at once for a seek or a pit teleport, and when told', () => {
    const st = newFollow();
    followStep(st, lap(0), 1 / 60, 1, 7, 2.2, false);
    const far = {...lap(0), x: 900, y: 900, heading: 0, travel: 0};
    const v = followStep(st, far, 1 / 60, 1, 7, 2.2, false);
    expect(v.camX).toBeCloseTo(893, 6);
    expect(v.camY).toBeCloseTo(900, 6);
    const hard = followStep(st, {...far, heading: Math.PI, travel: Math.PI}, 1 / 60, 1, 7, 2.2, true);
    expect(hard.camX).toBeCloseTo(907, 6);
  });
  it('turns to the body at a standstill and to the travel at speed', () => {
    const still = followStep(newFollow(), {x: 0, y: 0, z: 0, heading: 0, travel: Math.PI / 2, v: 0}, 1 / 60, 1, 7, 2.2, true);
    expect(still.camY).toBeCloseTo(0, 9);
    const fast = followStep(newFollow(), {x: 0, y: 0, z: 0, heading: 0, travel: Math.PI / 2, v: 20}, 1 / 60, 1, 7, 2.2, true);
    expect(fast.camX).toBeCloseTo(0, 9);
    expect(fast.camY).toBeCloseTo(-7, 9);
  });
});
