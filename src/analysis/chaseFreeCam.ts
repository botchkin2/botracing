// The browser's free camera round the followed car: drag turns it, the wheel zooms, Reset eases it back to the chase
// view. The offsets are the user's; chaseFollow adds them to the chase pose, so the follow never fights them.
// Plain TypeScript, imports one file.

import {angDiff, clamp, ease} from './chaseMath.ts';

export interface FreeCam {
  /** Radians turned round the car from straight behind it, + to the car's left. */
  yaw: number;
  /** Radians raised above the chase view's own elevation. */
  pitch: number;
  /** Multiplies the distance from the car. */
  zoom: number;
  /** Easing back to the chase view. */
  resetting: boolean;
}

export const newFreeCam = (): FreeCam => ({yaw: 0, pitch: 0, zoom: 1, resetting: false});

export const DRAG_RAD_PER_PX = 0.008;
/** The pitch offset's bounds; chaseFollow also keeps the camera above the ground. */
export const PITCH_MIN_RAD = -0.3;
export const PITCH_MAX_RAD = 1.2;
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 4;
const ZOOM_PER_WHEEL_PX = 0.001;
/** Time constant of the ease back to chase, seconds. */
export const RESET_TAU_S = 0.2;
const SETTLED_RAD = 0.002;
const SETTLED_ZOOM = 0.002;

/** Moved off the chase view: the Reset control shows. */
export const isFree = (f: FreeCam): boolean => f.yaw !== 0 || f.pitch !== 0 || f.zoom !== 1;

/** A drag of (dx, dy) screen pixels: right turns the camera to the left round the car, down lowers it. */
export function dragFree(f: FreeCam, dx: number, dy: number): void {
  f.resetting = false;
  f.yaw += dx * DRAG_RAD_PER_PX;
  f.pitch = clamp(f.pitch + dy * DRAG_RAD_PER_PX, PITCH_MIN_RAD, PITCH_MAX_RAD);
}

/** Wheel `deltaY` (positive scrolls down = away). */
export function zoomFree(f: FreeCam, deltaY: number): void {
  f.resetting = false;
  f.zoom = clamp(f.zoom * Math.exp(deltaY * ZOOM_PER_WHEEL_PX), ZOOM_MIN, ZOOM_MAX);
}

/** Start easing back to chase, the short way round. */
export function resetFree(f: FreeCam): void {
  if (!isFree(f)) return;
  f.yaw = angDiff(0, f.yaw);
  f.resetting = true;
}

/** One frame of the ease back; true while it still moves. */
export function stepFree(f: FreeCam, dt: number): boolean {
  if (!f.resetting) return false;
  const k = ease(dt, RESET_TAU_S);
  f.yaw -= f.yaw * k;
  f.pitch -= f.pitch * k;
  f.zoom += (1 - f.zoom) * k;
  if (Math.abs(f.yaw) < SETTLED_RAD && Math.abs(f.pitch) < SETTLED_RAD && Math.abs(f.zoom - 1) < SETTLED_ZOOM) {
    f.yaw = 0;
    f.pitch = 0;
    f.zoom = 1;
    f.resetting = false;
    return false;
  }
  return true;
}
