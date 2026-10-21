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
  it('keeps the car on the camera axis in a steady bend: the lead cancels the lag', () => {
    // without the lead a time constant of 0.2 s on a 0.5 rad/s turn trails by tau x rate = 0.1 rad (5.7 deg)
    for (const d of run(60).slice(120)) expect(d.offAxis * (180 / Math.PI)).toBeLessThan(0.5);
  });
  it.each([1, 4])('stays within a few degrees through a hairpin at %ix (the old 0.3 s lag was 17 to 18 degrees)', rate => {
    const R = 20;
    const v = 22;
    const total = (60 + Math.PI * R + 60) / v;
    const st = newFollow();
    const errs: number[] = [];
    for (let t = 0; t < total; t += rate / 60) {
      const s = v * t;
      const a = Math.min(Math.max((s - 60) / R, 0), Math.PI);
      const arc = s > 60 && s < 60 + Math.PI * R;
      const car: FollowCar = s <= 60
        ? {x: s, y: 0, z: 0, heading: 0, travel: 0, v}
        : arc
          ? {x: 60 + R * Math.sin(a), y: R * (1 - Math.cos(a)), z: 0, heading: a, travel: a, v}
          : {x: 60 - (s - 60 - Math.PI * R), y: 2 * R, z: 0, heading: Math.PI, travel: Math.PI, v};
      const view = followStep(st, car, 1 / 60 / 1, rate, 7, 2.2, false);
      const seen = Math.atan2(car.y - view.camY, car.x - view.camX);
      if (t > 1) errs.push(Math.abs(Math.atan2(Math.sin(seen - car.heading), Math.cos(seen - car.heading))) * (180 / Math.PI));
    }
    errs.sort((a, b) => a - b);
    expect(errs[Math.floor(errs.length * 0.95)]).toBeLessThan(8);
    expect(errs.at(-1)).toBeLessThan(10);
  });
  it('does not move at all when the car has not (dt 0: a pause), whatever the smoothing still owed', () => {
    const st = newFollow();
    for (let t = 0; t < 1; t += 1 / 60) followStep(st, lap(t), 1 / 60, 1, 7, 2.2, false);
    const car = lap(1);
    const a = followStep(st, car, 1 / 60, 1, 7, 2.2, false);
    const b = followStep(st, car, 0, 1, 7, 2.2, false);
    const c = followStep(st, car, 0, 1, 7, 2.2, false);
    expect(b.camX).toBeCloseTo(a.camX, 1);
    expect(c).toEqual(b);
  });
  it('a free turn puts the camera round the car at the same distance, and zoom scales that distance', () => {
    const st = newFollow();
    const car: FollowCar = {x: 0, y: 0, z: 0, heading: 0, travel: 0, v: 20};
    followStep(st, car, 1 / 60, 1, 7, 2.2, true);
    const side = followStep(st, car, 0, 1, 7, 2.2, false, {yaw: Math.PI / 2, pitch: 0, zoom: 1, resetting: false});
    expect(side.camX).toBeCloseTo(0, 6);
    expect(side.camY).toBeCloseTo(-7, 6);
    expect(side.camZ).toBeCloseTo(2.2, 6);
    const far = followStep(st, car, 0, 1, 7, 2.2, false, {yaw: 0, pitch: 0, zoom: 2, resetting: false});
    expect(Math.hypot(far.camX, far.camY, far.camZ)).toBeCloseTo(2 * Math.hypot(7, 2.2), 6);
    const up = followStep(st, car, 0, 1, 7, 2.2, false, {yaw: 0, pitch: 5, zoom: 1, resetting: false});
    expect(up.camZ).toBeGreaterThan(7); // clamped just short of straight down, never underneath
    expect(up.camZ).toBeLessThan(Math.hypot(7, 2.2) + 0.01);
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
