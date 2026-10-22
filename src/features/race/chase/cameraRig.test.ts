import {describe, expect, it} from '@jest/globals';
import * as THREE from 'three';

import type {RoadIndex} from '@/src/analysis/chaseRoadIndex';

import {createCameraRig, type FollowedCar} from './cameraRig';

const car = (x: number, y: number, heading = 0): FollowedCar => ({
  x,
  y,
  z: 3,
  heading,
  travel: heading,
  ld: x,
  lateral: 0,
  onRoad: true,
  v: 30,
});

// a straight road along +x, 5 m steps: what TV and Heli read
const N = 400;
const roadStub = {
  stepM: 5,
  lengthM: N * 5,
  heading: new Array(N).fill(0),
  centreX: Array.from({length: N}, (_, i) => i * 5),
  centreY: new Array(N).fill(0),
  normalX: new Array(N).fill(0),
  normalY: new Array(N).fill(1),
  curvatureAt: () => 0,
  widthAt: () => 6,
  heightAt: () => 0,
  tangentAt: () => 0,
} as unknown as RoadIndex;

function setup() {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 6000);
  const rig = createCameraRig(camera, () => roadStub);
  const pose = () => [camera.position.x, camera.position.y, camera.position.z, camera.fov];
  return {camera, rig, pose};
}

describe('camera rig', () => {
  it.each([1, 2, 3, 4] as const)('stays finite on paused frames that follow playing ones, in every mode (%i)', mode => {
    const {camera, rig, pose} = setup();
    rig.mode = mode;
    for (let i = 0; i < 30; i++) rig.update(1 / 60, car(i * 0.5, 0), true, 1);
    for (let i = 0; i < 30; i++) rig.update(i === 0 ? 1 / 60 : 0.016, car(15, 0), false, 1);
    for (const n of pose()) expect(Number.isFinite(n)).toBe(true);
    expect(Number.isFinite(camera.quaternion.x)).toBe(true);
  });
  it('stays finite through play, pause, a seek while paused and resume', () => {
    const {rig, pose} = setup();
    for (let i = 0; i < 120; i++) rig.update(1 / 60, car(i * 0.5, 0), true, 1);
    rig.update(1 / 60, car(60, 0), false, 1);
    rig.update(1 / 60, car(900, 400, 1.2), false, 1);
    for (const n of pose()) expect(Number.isFinite(n)).toBe(true);
    for (let i = 0; i < 60; i++) rig.update(1 / 60, car(900 + i * 0.5, 400, 1.2), true, 1);
    for (const n of pose()) expect(Number.isFinite(n)).toBe(true);
  });
  it('a pause moves nothing: the pose is identical on every paused frame, at any smoothing owed', () => {
    const {rig, pose} = setup();
    // into a bend, so the smoothing still owes the camera a swing at the moment of the pause
    for (let i = 0; i < 90; i++) {
      const a = i * 0.02;
      rig.update(1 / 60, car(100 * Math.sin(a), 100 * (1 - Math.cos(a)), a), true, 1);
    }
    const before = pose();
    for (const n of before) expect(Number.isFinite(n)).toBe(true);
    const held = car(100 * Math.sin(1.8), 100 * (1 - Math.cos(1.8)), 1.8);
    rig.update(1 / 60, held, true, 1);
    const last = pose();
    rig.update(1 / 60, held, false, 1);
    expect(pose()).toEqual(last);
    for (let i = 0; i < 30; i++) rig.update(1 / 60, held, false, 1);
    expect(pose()).toEqual(last);
    for (const n of pose()) expect(Number.isFinite(n)).toBe(true); // toEqual treats NaN as equal to NaN
    expect(before).not.toEqual(last);
  });
  it('Reset eases the free camera back while paused, and drag moves it round the car', () => {
    const {rig, pose} = setup();
    const still = car(0, 0);
    for (let i = 0; i < 10; i++) rig.update(1 / 60, still, true, 1);
    const chase = pose();
    rig.free.yaw = 1;
    rig.update(1 / 60, still, false, 1);
    expect(pose()).not.toEqual(chase);
    rig.free.resetting = true;
    for (let i = 0; i < 200; i++) rig.update(1 / 60, still, false, 1);
    for (let i = 0; i < 4; i++) expect(pose()[i]).toBeCloseTo(chase[i], 3);
  });
});
