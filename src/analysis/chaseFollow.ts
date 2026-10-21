// The chase camera of a game: it hangs a fixed distance behind the followed car on a smoothed direction and looks at
// the car, so the car stays in the middle of the frame at any bend and its size never changes. Only the direction (and
// the camera's height) are smoothed; the camera is never a lagging position, so the distance to the car cannot pump.
// Plain TypeScript, imports one file.

import {angDiff, clamp, ease} from './chaseMath.ts';
import {newFreeCam, type FreeCam} from './chaseFreeCam.ts';

/**
 * Time constant of the swing round a bend, seconds of wall time at 1x (divided by the playback rate above 1x). A plain
 * first-order lag trails a steady turn by rate x tau (18 degrees through a hairpin at 60 deg/s with the old 0.3 s), so the camera also
 * leads by the measured turn rate times tau: no lag in a steady turn, and the same smoothing on a straight.
 */
export const YAW_TAU_S = 0.2;
/** Time constant of the turn-rate estimate the lead uses, seconds of wall time. */
export const RATE_TAU_S = 0.15;
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
/** The free camera stays above the ground and below straight down. */
const MIN_ELEV_RAD = 0.03;
const MAX_ELEV_RAD = 1.45;
const FREE_NONE = newFreeCam();

export interface FollowState {
  /** The lagged direction (world angle, 0 along +x); the camera's own is this plus the lead. */
  yaw: number;
  /** The direction asked for last frame, and its turn rate (radians per wall second, smoothed). */
  dir: number;
  rate: number;
  /** The camera's height. */
  z: number;
  /** Where the car was last frame. */
  x: number;
  y: number;
  set: boolean;
}

export const newFollow = (): FollowState => ({yaw: 0, dir: 0, rate: 0, z: 0, x: 0, y: 0, set: false});

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
export function followStep(
  st: FollowState,
  car: FollowCar,
  dt: number,
  rate: number,
  backM: number,
  upM: number,
  hard: boolean,
  free: FreeCam = FREE_NONE,
): FollowView {
  const w = clamp((car.v - TRAVEL_FROM_MS) / (TRAVEL_FULL_MS - TRAVEL_FROM_MS), 0, 1);
  const dir = car.travel === null ? car.heading : car.heading + angDiff(car.heading, car.travel) * w;
  const jumped = Math.hypot(car.x - st.x, car.y - st.y) > JUMP_M + car.v * dt * Math.max(1, rate) * 2;
  const snap = hard || !st.set || jumped;
  const slow = Math.max(1, rate);
  const tau = YAW_TAU_S / slow;
  if (snap) {
    st.yaw = dir;
    st.rate = 0;
    st.z = car.z + upM;
  } else {
    if (dt > 0) st.rate += (angDiff(st.dir, dir) / dt - st.rate) * ease(dt, RATE_TAU_S / slow);
    st.yaw += angDiff(st.yaw, dir) * ease(dt, tau);
    st.z += (car.z + upM - st.z) * ease(dt, LIFT_TAU_S / slow);
  }
  st.dir = dir;
  st.x = car.x;
  st.y = car.y;
  st.set = true;
  const aim = st.yaw + (snap ? 0 : st.rate * tau);
  const cx = Math.cos(aim);
  const cy = Math.sin(aim);
  const lead = Math.min(LEAD_MAX_M, car.v * LEAD_S);
  // the user's turn, raise and zoom round the car; none of them is the chase pose (no offset: exactly backM and upM)
  const radius = Math.hypot(backM, upM) * free.zoom;
  const elev = clamp(Math.atan2(upM, backM) + free.pitch, MIN_ELEV_RAD, MAX_ELEV_RAD);
  const fx = Math.cos(aim + free.yaw);
  const fy = Math.sin(aim + free.yaw);
  return {
    camX: car.x - fx * radius * Math.cos(elev),
    camY: car.y - fy * radius * Math.cos(elev),
    camZ: st.z - upM + radius * Math.sin(elev),
    lookX: car.x + cx * lead,
    lookY: car.y + cy * lead,
    lookZ: car.z + LOOK_LIFT_M,
  };
}
