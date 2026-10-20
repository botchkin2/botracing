// What the player's pedals are doing, in the four states the road ribbon paints. The HUD's pedal bars use the same
// states, so a colour on the road and a colour on a bar mean the same thing.

export type InputState = 'brake' | 'full' | 'part' | 'coast';

const BRAKE_PCT = 4;
const FULL_THROTTLE_PCT = 96;
const LIFT_PCT = 8;

/** Brake wins over throttle on the road (a car braking is braking); the HUD asks for throttle on its own with `throttleState`. */
export function inputState(brakePct: number, throttlePct: number): InputState {
  return brakePct > BRAKE_PCT ? 'brake' : throttleState(throttlePct);
}

export function throttleState(throttlePct: number): 'full' | 'part' | 'coast' {
  return throttlePct > FULL_THROTTLE_PCT ? 'full' : throttlePct > LIFT_PCT ? 'part' : 'coast';
}
