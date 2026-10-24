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

describe('camera rig: finite everywhere', () => {
  // Every output is checked with Number.isFinite, not toEqual (which says NaN equals NaN): a frame of any length, in
  // any mode, playing, paused or seeking, hands the camera a finite pose, field of view and orientation.
  const DTS = [0, 1e-9, 1 / 240, 1 / 60, 0.05, 5, -0.01, NaN];
  it.each([1, 2, 3, 4] as const)('mode %i: play, pause, seek, resume, at every dt', mode => {
    for (const rate of [1, 4, 16]) {
      const {camera, rig} = setup();
      rig.mode = mode;
      let x = 0;
      for (const dt of DTS) {
        for (const step of ['play', 'pause', 'pause', 'seek', 'pause', 'resume'] as const) {
          if (step === 'seek') x += 1500;
          if (step === 'play' || step === 'resume') x += 0.5 * rate;
          rig.update(dt, car(x, 0), step === 'play' || step === 'resume', rate);
          const p = camera.position;
          for (const n of [p.x, p.y, p.z, camera.fov, camera.quaternion.x, camera.quaternion.w]) {
            if (!Number.isFinite(n)) throw new Error(`mode ${mode} rate ${rate} dt ${dt} step ${step}: ${n}`);
          }
        }
      }
    }
  });
  it('a paused frame after a free drag, and the Reset ease with dt 0, stay finite', () => {
    const {camera, rig} = setup();
    for (let i = 0; i < 10; i++) rig.update(1 / 60, car(i, 0), true, 1);
    rig.free.yaw = 2;
    rig.free.pitch = 5;
    rig.free.zoom = 40;
    rig.free.resetting = true;
    for (const dt of [0, 0, 1 / 60, 0, 5]) {
      rig.update(dt, car(10, 0), false, 1);
      for (const n of [camera.position.x, camera.position.y, camera.position.z, camera.fov]) expect(Number.isFinite(n)).toBe(true);
    }
  });
});
