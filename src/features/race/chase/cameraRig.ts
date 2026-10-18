// The camera: a smoothed follow with a little lag, no bounce. Chase sits behind and above the followed car; High is the
// same from further up; TV stands trackside ahead and turns to watch; Heli hovers and can be dragged round. Paused, the
// camera snaps to its exact place so nothing drifts on a still frame.

import * as THREE from 'three';
import {angDiff, clamp, ease, lerp, mod} from '../../../analysis/chaseMath';
import type {RoadIndex} from '../../../analysis/chaseRoadIndex';
import {setWorld} from './sceneFrame';
import type {ChaseCamMode} from './chaseTypes';

const CHASE_BACK_M = 11;
const CHASE_UP_M = 4.2;
const HIGH_BACK_M = 18;
const HIGH_UP_M = 8;
const LOOK_AHEAD_M = 32;
const MIN_ABOVE_ROAD_M = 1.4;
const BASE_FOV = 50;
const SPEED_FOV_GAIN = 9;
const FULL_SPEED_MS = 80;
const OTHER_FOV = 55;
const TV_EVERY_BINS = 45;
const TV_OFF_ROAD_M = 18;
const TV_UP_M = 5;
const TV_SUBJECT_M = 14;
const HELI_BACK_M = 60;
const HELI_UP_M = 42;

export interface FollowedCar {
  x: number;
  y: number;
  z: number;
  /** World angle, 0 along +x. */
  heading: number;
  /** Lap distance, metres. */
  ld: number;
  /** m/s. */
  v: number;
}

export interface CameraRig {
  mode: ChaseCamMode;
  /** How far Heli has been dragged round, radians. */
  orbit: number;
  update(dt: number, me: FollowedCar, playing: boolean): void;
  /** The followed car changed: place the camera afresh. */
  reset(): void;
}

interface TvRig {
  s: number;
  x: number;
  y: number;
  z: number;
}

export function createCameraRig(camera: THREE.PerspectiveCamera, getIndex: () => RoadIndex | null): CameraRig {
  const at = {x: 0, y: 0, z: 0, yaw: 0, lx: 0, ly: 0, lz: 0};
  const target = new THREE.Vector3();
  let init = false;
  let lastMode: ChaseCamMode | 0 = 0;
  let tv: TvRig | null = null;

  /** A camera on the outside of the bend at the given bin, off the edge of the road. */
  function tvAt(ix: RoadIndex, bin: number): TvRig {
    const i = mod(bin, ix.heading.length);
    const s = i * ix.stepM;
    const side = ix.curvatureAt(s) > 0 ? 1 : -1;
    const off = ix.widthAt(s, side) + TV_OFF_ROAD_M;
    return {
      s,
      x: ix.centreX[i] + ix.normalX[i] * side * off,
      y: ix.centreY[i] + ix.normalY[i] * side * off,
      z: ix.heightAt(s) + TV_UP_M,
    };
  }

  const rig: CameraRig = {
    mode: 1,
    orbit: 0,
    reset() {
      init = false;
      tv = null;
    },
    update(dt, me, playing) {
      const ix = getIndex();
      if (!ix) return;
      const mode = rig.mode;
      const hard = !init || lastMode !== mode || !playing;
      const dirx = Math.cos(me.heading);
      const diry = Math.sin(me.heading);
      let px: number;
      let py: number;
      let pz: number;
      let lx: number;
      let ly: number;
      let lz: number;
      let tp = 0.28; // position time constant, s
      let tl = 0.2; // look-at time constant, s
      if (mode === 1 || mode === 2) {
        const back = mode === 1 ? CHASE_BACK_M : HIGH_BACK_M;
        const up = mode === 1 ? CHASE_UP_M : HIGH_UP_M;
        if (hard) at.yaw = me.heading;
        const lead = clamp(ix.curvatureAt(me.ld + 30) * 18, -0.12, 0.12);
        at.yaw += angDiff(at.yaw, me.heading + lead) * (hard ? 1 : ease(dt, 0.5));
        const cx = Math.cos(at.yaw);
        const cy = Math.sin(at.yaw);
        px = me.x - cx * back;
        py = me.y - cy * back;
        pz = Math.max(me.z + up, ix.heightAt(me.ld - back) + MIN_ABOVE_ROAD_M);
        lx = me.x + cx * LOOK_AHEAD_M;
        ly = me.y + cy * LOOK_AHEAD_M;
        lz = ix.heightAt(me.ld + LOOK_AHEAD_M) + 0.6;
      } else if (mode === 3) {
        const bins = (s: number) => s / ix.stepM / TV_EVERY_BINS;
        if (!tv) tv = tvAt(ix, (Math.floor(bins(me.ld)) + 1) * TV_EVERY_BINS);
        const ahead = mod(tv.s - me.ld + ix.lengthM / 2, ix.lengthM) - ix.lengthM / 2;
        if (ahead < -60 || ahead > 650) tv = tvAt(ix, Math.ceil(bins(me.ld + 160)) * TV_EVERY_BINS);
        px = tv.x;
        py = tv.y;
        pz = tv.z;
        lx = me.x + dirx * 3;
        ly = me.y + diry * 3;
        lz = me.z + 0.4;
        tp = 0;
        tl = 0.25;
      } else {
        if (hard && lastMode !== mode) rig.orbit = 0;
        const oa = me.heading + Math.PI + rig.orbit;
        px = me.x + Math.cos(oa) * HELI_BACK_M;
        py = me.y + Math.sin(oa) * HELI_BACK_M;
        pz = me.z + HELI_UP_M;
        lx = me.x + dirx * 8;
        ly = me.y + diry * 8;
        lz = me.z;
        tp = 0.6;
        tl = 0.3;
      }
      const kp = hard || tp === 0 ? 1 : ease(dt, tp);
      const kl = hard ? 1 : ease(dt, tl);
      const kz = hard || tp === 0 ? 1 : ease(dt, tp * 1.4);
      at.x = lerp(at.x, px, kp);
      at.y = lerp(at.y, py, kp);
      at.z = lerp(at.z, pz, kz);
      at.lx = lerp(at.lx, lx, kl);
      at.ly = lerp(at.ly, ly, kl);
      at.lz = lerp(at.lz, lz, kl);
      lastMode = mode;
      init = true;
      setWorld(camera.position, at.x, at.y, at.z);
      setWorld(target, at.lx, at.ly, at.lz);
      camera.up.set(0, 1, 0);
      camera.lookAt(target);
      // TV zooms to keep the car the same size at any distance; Chase widens a little with speed
      const fov =
        mode === 3
          ? clamp((2 * Math.atan(TV_SUBJECT_M / Math.max(Math.hypot(lx - px, ly - py, lz - pz), 1)) * 180) / Math.PI, 12, OTHER_FOV)
          : mode === 1
            ? BASE_FOV + clamp(me.v / FULL_SPEED_MS, 0, 1) * SPEED_FOV_GAIN
            : OTHER_FOV;
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = lerp(camera.fov, fov, hard ? 1 : ease(dt, 0.3));
        camera.updateProjectionMatrix();
      }
    },
  };
  return rig;
}
