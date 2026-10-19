// The camera rides the road, not the car. Chase and High sit on the road behind the followed car, at its own offset
// from the centre line, and look down the road ahead of it, so the car's angle to the road is what shows: the camera
// never turns with the car's yaw, and it has no lag that would invent one (thread 83, chord #6138: the real body is
// within 2.7 degrees of its travel at p95 in corners). Paused is the same frame as playing. TV stands trackside ahead
// and turns to watch; Heli hovers behind along the road and can be dragged round. Off the road (pits, a spin into the
// gravel) the camera follows the car's direction of travel instead.

import * as THREE from 'three';
import {angDiff, clamp, ease, lerp, mod} from '@/src/analysis/chaseMath';
import type {RoadIndex} from '@/src/analysis/chaseRoadIndex';
import {setWorld} from './sceneFrame';
import type {ChaseCamMode} from '@/src/features/race/chase/chaseTypes';

const CHASE_BACK_M = 10;
const CHASE_UP_M = 3.2;
const HIGH_BACK_M = 20;
const HIGH_UP_M = 9;
/** Look-ahead down the road: grows with speed (metres plus seconds of travel), within bounds. */
const LOOK_MIN_M = 18;
const LOOK_S = 0.45;
const LOOK_MAX_M = 55;
const LOOK_LIFT_M = 0.9;
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

/** A point on the road at lap distance `s`, `lateral` metres right of the centre line, on the road's surface. */
function roadPoint(ix: RoadIndex, s: number, lateral: number): {x: number; y: number; z: number} {
  const f = mod(s / ix.stepM, ix.heading.length);
  const i = Math.floor(f);
  const j = (i + 1) % ix.heading.length;
  const t = f - i;
  const nx = lerp(ix.normalX[i], ix.normalX[j], t);
  const ny = lerp(ix.normalY[i], ix.normalY[j], t);
  return {
    x: lerp(ix.centreX[i], ix.centreX[j], t) + nx * lateral,
    y: lerp(ix.centreY[i], ix.centreY[j], t) + ny * lateral,
    z: ix.heightAt(s),
  };
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
        const look = clamp(LOOK_MIN_M + me.v * LOOK_S, LOOK_MIN_M, LOOK_MAX_M);
        if (me.onRoad) {
          // both ends on the road at the car's own offset: the view turns with the road, never with the car
          const cam = roadPoint(ix, me.ld - back, me.lateral);
          const ahead = roadPoint(ix, me.ld + look, me.lateral);
          px = cam.x;
          py = cam.y;
          pz = cam.z + up;
          lx = ahead.x;
          ly = ahead.y;
          lz = ahead.z + LOOK_LIFT_M;
          tp = 0;
          tl = 0;
        } else {
          const dir = me.travel ?? me.heading;
          if (hard) at.yaw = dir;
          at.yaw += angDiff(at.yaw, dir) * (hard ? 1 : ease(dt, 0.35));
          const cx = Math.cos(at.yaw);
          const cy = Math.sin(at.yaw);
          px = me.x - cx * back;
          py = me.y - cy * back;
          pz = me.z + up;
          lx = me.x + cx * look;
          ly = me.y + cy * look;
          lz = me.z + LOOK_LIFT_M;
        }
      } else if (mode === 3) {
        const bins = (s: number) => s / ix.stepM / TV_EVERY_BINS;
        if (!tv) tv = tvAt(ix, (Math.floor(bins(me.ld)) + 1) * TV_EVERY_BINS);
        const ahead = mod(tv.s - me.ld + ix.lengthM / 2, ix.lengthM) - ix.lengthM / 2;
        if (ahead < -60 || ahead > 650) tv = tvAt(ix, Math.ceil(bins(me.ld + 160)) * TV_EVERY_BINS);
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
