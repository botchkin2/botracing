// The chase camera of a game: it hangs a fixed distance behind the followed car's BODY on a smoothed direction and looks
// at the car, so the car stays in the middle of the frame at any bend and its size never changes. Only the direction
// (and the camera's height) are smoothed; the camera is never a lagging position, so the distance to the car cannot
// pump. It follows the body, never the direction of motion: a car in a slide or a spin moves one way and points
// another, and a camera that followed the motion sat in front of the car for seconds and swung 180 degrees when the
// speed dropped (Sebring 2026-10-21, pit-wall thread 94 #6896). The body heading comes already chosen (chaseHeading).
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
/** A turn rate under this (rad/s, 9 deg/s) is noise on a straight, not a bend: it earns no lead, and the lead grows from here. */
export const RATE_DEADBAND = 0.15;
/** Time constant of the camera's height following the car's. */
export const LIFT_TAU_S = 0.25;
/** A move of the car further than this in one frame (more than the playback rate explains) is a seek or a pit teleport: no smoothing. */
export const JUMP_M = 40;
/** The lead never turns the camera further than this ahead of the body (radians, 20 degrees): a spin must not throw it. */
export const LEAD_MAX_RAD = 0.35;
/**
 * The most the camera may turn in a second of race time (radians per second, 360 degrees), scaled by the playback rate
 * so a hairpin at 4x is still followed. A car spinning faster out-runs the camera instead of dragging it round. 360 and not 180 because never being in front of the car
 * outranks turning slowly: at 180 a spin left the camera over 90 degrees off the body on 39 spin frames of 3235 (max 178), at 360 on 20 (max 100) (thread 94 #6906).
 */
export const AIM_RATE_MAX = Math.PI * 2;
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
  /** Where the camera looked last frame (the lagged direction plus the lead, turn-rate limited). */
  aim: number;
  /** The camera's height. */
  z: number;
  /** Where the car was last frame. */
  x: number;
  y: number;
  set: boolean;
}

export const newFollow = (): FollowState => ({yaw: 0, dir: 0, rate: 0, aim: 0, z: 0, x: 0, y: 0, set: false});

export interface FollowCar {
  x: number;
  y: number;
  z: number;
  /** World angle of the body, 0 along +x. */
  heading: number;
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

const maxTurn = (dt: number, slow: number) => (dt > 0 ? AIM_RATE_MAX * slow * dt : 0);

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
  const dir = car.heading;
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
  const lead = snap ? 0 : clamp(Math.sign(st.rate) * Math.max(0, Math.abs(st.rate) - RATE_DEADBAND) * tau, -LEAD_MAX_RAD, LEAD_MAX_RAD);
  const target = st.yaw + lead;
  if (snap) st.aim = target;
  else st.aim += clamp(angDiff(st.aim, target), -maxTurn(dt, slow), maxTurn(dt, slow));
  const aim = st.aim;
  const cx = Math.cos(aim);
  const cy = Math.sin(aim);
  const ahead = Math.min(LEAD_MAX_M, car.v * LEAD_S);
  // the user's turn, raise and zoom round the car; none of them is the chase pose (no offset: exactly backM and upM)
  const radius = Math.hypot(backM, upM) * free.zoom;
  const elev = clamp(Math.atan2(upM, backM) + free.pitch, MIN_ELEV_RAD, MAX_ELEV_RAD);
  const fx = Math.cos(aim + free.yaw);
  const fy = Math.sin(aim + free.yaw);
  return {
    camX: car.x - fx * radius * Math.cos(elev),
    camY: car.y - fy * radius * Math.cos(elev),
    camZ: st.z - upM + radius * Math.sin(elev),
    lookX: car.x + cx * ahead,
    lookY: car.y + cy * ahead,
    lookZ: car.z + LOOK_LIFT_M,
  };
}
