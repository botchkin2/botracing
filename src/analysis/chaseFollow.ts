// The chase camera of a game: it hangs a fixed distance behind the followed car on a smoothed direction and looks at
// the car, so the car stays in the middle of the frame at any bend and its size never changes. Only the direction (and
// the camera's height) are smoothed; the camera is never a lagging position, so the distance to the car cannot pump.
// Plain TypeScript, imports one file.

import {angDiff, clamp, ease} from './chaseMath.ts';

/** Time constant of the swing round a bend, seconds of wall time at 1x (divided by the playback rate above 1x). */
export const YAW_TAU_S = 0.3;
/** Time constant of the camera's height following the car's. */
export const LIFT_TAU_S = 0.25;
/** A move of the car further than this in one frame (more than the playback rate explains) is a seek or a pit teleport: no smoothing. */
export const JUMP_M = 40;
/** Below this speed the direction of travel is noise and the body heading is used; between the two it blends. */
export const TRAVEL_FROM_MS = 3;
export const TRAVEL_FULL_MS = 8;
/** The camera looks this far ahead of the car along its direction, seconds of travel, at most LEAD_MAX_M. */
export const LEAD_S = 0.1;
export const LEAD_MAX_M = 4;
export const LOOK_LIFT_M = 0.9;

export interface FollowState {
  /** The smoothed direction (world angle, 0 along +x). */
  yaw: number;
  /** The camera's height. */
  z: number;
  /** Where the car was last frame. */
  x: number;
  y: number;
  set: boolean;
}

export const newFollow = (): FollowState => ({yaw: 0, z: 0, x: 0, y: 0, set: false});

export interface FollowCar {
  x: number;
  y: number;
  z: number;
  /** World angle of the body, 0 along +x. */
  heading: number;
  /** World angle of the direction of travel, null until known. */
  travel: number | null;
  /** m/s. */
  v: number;
}

export interface FollowView {
  camX: number;
  camY: number;
  camZ: number;
  lookX: number;
  lookY: number;
  lookZ: number;
}

/**
 * One frame. `dt` is wall seconds, `rate` the playback rate (the car covers `rate` times the road per second, so the
 * swing is `rate` times quicker to keep up), `hard` snaps (paused, first frame, a new car).
 */
export function followStep(st: FollowState, car: FollowCar, dt: number, rate: number, backM: number, upM: number, hard: boolean): FollowView {
  const w = clamp((car.v - TRAVEL_FROM_MS) / (TRAVEL_FULL_MS - TRAVEL_FROM_MS), 0, 1);
  const dir = car.travel === null ? car.heading : car.heading + angDiff(car.heading, car.travel) * w;
  const jumped = Math.hypot(car.x - st.x, car.y - st.y) > JUMP_M + car.v * dt * Math.max(1, rate) * 2;
  const snap = hard || !st.set || jumped;
  const slow = Math.max(1, rate);
  if (snap) {
    st.yaw = dir;
    st.z = car.z + upM;
  } else {
    st.yaw += angDiff(st.yaw, dir) * ease(dt, YAW_TAU_S / slow);
    st.z += (car.z + upM - st.z) * ease(dt, LIFT_TAU_S / slow);
  }
  st.x = car.x;
  st.y = car.y;
  st.set = true;
  const cx = Math.cos(st.yaw);
  const cy = Math.sin(st.yaw);
  const lead = Math.min(LEAD_MAX_M, car.v * LEAD_S);
  return {
    camX: car.x - cx * backM,
    camY: car.y - cy * backM,
    camZ: st.z,
    lookX: car.x + cx * lead,
    lookY: car.y + cy * lead,
    lookZ: car.z + LOOK_LIFT_M,
  };
}
