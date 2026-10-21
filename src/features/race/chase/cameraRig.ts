// The chase camera. Chase and High are a game's chase cam: a fixed distance behind the followed car on a smoothed
// direction, looking at the car, so the car stays in the middle of the frame through any bend (analysis/chaseFollow.ts).
// TV stands trackside ahead and turns to watch; Heli hovers behind along the road and can be dragged round. Neither
// reads the road under the car for Chase or High: a road coordinate is not what keeps a car in view.

import * as THREE from 'three';
import {clamp, ease, lerp, mod} from '@/src/analysis/chaseMath';
import {followStep, newFollow} from '@/src/analysis/chaseFollow';
import {newFreeCam, stepFree, type FreeCam} from '@/src/analysis/chaseFreeCam';
import type {RoadIndex} from '@/src/analysis/chaseRoadIndex';
import {setWorld} from './sceneFrame';
import type {ChaseCamMode} from '@/src/features/race/chase/chaseTypes';

const CHASE_BACK_M = 7;
const CHASE_UP_M = 2.2;
const HIGH_BACK_M = 20;
const HIGH_UP_M = 9;
const BASE_FOV = 50;
const SPEED_FOV_GAIN = 9;
const FULL_SPEED_MS = 80;
const OTHER_FOV = 55;
const TV_EVERY_M = 450;
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
  /** Direction of travel (world angle), null until known. */
  travel: number | null;
  /** Lap distance, metres: the nearest road point's when on the road. */
  ld: number;
  /** Signed metres from the centre line, + to the right of the road's direction. */
  lateral: number;
  onRoad: boolean;
  /** m/s. */
  v: number;
}

export interface CameraRig {
  mode: ChaseCamMode;
  /** How far Heli has been dragged round, radians. */
  orbit: number;
  /** The user's turn, raise and zoom round the followed car in Chase and High (the browser's free camera). */
  free: FreeCam;
  /** `dt` wall seconds, `rate` the playback rate. */
  update(dt: number, me: FollowedCar, playing: boolean, rate: number): void;
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
  const follow = newFollow();
  const last = {x: NaN, y: NaN, heading: NaN};

  /** A camera on the outside of the bend at the given lap distance, off the edge of the road. */
  function tvAt(ix: RoadIndex, atM: number): TvRig {
    const i = mod(Math.round(atM / ix.stepM), ix.heading.length);
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
    free: newFreeCam(),
    reset() {
      init = false;
      follow.set = false;
      tv = null;
    },
    update(dtS, me, playing, rate) {
      let dt = dtS;
      const ix = getIndex();
      if (!ix) return;
      const mode = rig.mode;
      // Paused: nothing eases. The camera stays exactly where the last frame left it unless the car was moved (a seek:
      // placed afresh) or the user moves the camera, so a pause never shifts the view.
      const carMoved = me.x !== last.x || me.y !== last.y || me.heading !== last.heading;
      const hard = !init || lastMode !== mode || (!playing && carMoved);
      if (!playing && !carMoved) dt = 0;
      last.x = me.x;
      last.y = me.y;
      last.heading = me.heading;
      stepFree(rig.free, dtS);
      let px: number;
      let py: number;
      let pz: number;
      let lx: number;
      let ly: number;
      let lz: number;
      let tp = 0.28; // position time constant, s
      let tl = 0.2; // look-at time constant, s
      if (mode === 1 || mode === 2) {
        const v = followStep(
          follow,
          me,
          dt,
          rate,
          mode === 1 ? CHASE_BACK_M : HIGH_BACK_M,
          mode === 1 ? CHASE_UP_M : HIGH_UP_M,
          hard,
          rig.free,
        );
        px = v.camX;
        py = v.camY;
        pz = v.camZ;
        lx = v.lookX;
        ly = v.lookY;
        lz = v.lookZ;
        tp = 0;
        tl = 0;
      } else if (mode === 3) {
        const spots = (s: number) => s / TV_EVERY_M;
        if (!tv) tv = tvAt(ix, (Math.floor(spots(me.ld)) + 1) * TV_EVERY_M);
        const ahead = mod(tv.s - me.ld + ix.lengthM / 2, ix.lengthM) - ix.lengthM / 2;
        if (ahead < -60 || ahead > 650) tv = tvAt(ix, Math.ceil(spots(me.ld + 160)) * TV_EVERY_M);
        px = tv.x;
        py = tv.y;
        pz = tv.z;
        lx = me.x;
        ly = me.y;
        lz = me.z + 0.6;
        tp = 0;
        tl = 0.25;
      } else {
        if (hard && lastMode !== mode) rig.orbit = 0;
        const along = me.onRoad ? ix.tangentAt(me.ld) : (me.travel ?? me.heading);
        const oa = along + Math.PI + rig.orbit;
        px = me.x + Math.cos(oa) * HELI_BACK_M;
        py = me.y + Math.sin(oa) * HELI_BACK_M;
        pz = me.z + HELI_UP_M;
        lx = me.x + Math.cos(along) * 8;
        ly = me.y + Math.sin(along) * 8;
        lz = me.z;
        tp = 0;
        tl = 0;
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
