// What a driver's hands did in one corner, read off the recorded samples
// (pit wall thread 58 #3751, #3767: bias set and proved these on the 2 Oct
// Road Atlanta race). Pure; cornerFacts.mjs calls it once per corner window.

// The version of these rules and of what each corner window's facts mean
// (analyze.mjs blockVersions): bump it when a definition below changes.
// 1: brake point and peak from the corner's own application (a section's
//    single corner: the section's), full throttle is the held point, turn-in
//    from the steering and throttle pickup / lowest throttle added (thread 58).
export const CORNER_INPUTS_VERSION = 1;

// Turn-in: going back from the peak steering on the corner's own side, the last
// sample below this share of the peak. 10 % put Road Atlanta T1 on a pre-steer
// on the straight, 90 m early, and left a flat-out corner with none; 20 % did
// neither.
export const TURN_IN_FRACTION = 0.2;
// A peak below this (steer_pct, % of lock) is a kink, not a corner to turn into.
export const TURN_IN_FLOOR_PCT = 3;
// Throttle pickup: the end of the closed-throttle phase. Closed is below
// CLOSED, open is CLOSED_ABOVE or more; the pedal's own noise sits under 5.
export const THROTTLE_CLOSED_PCT = 5;
export const THROTTLE_OPEN_PCT = 10;

/**
 * Which sign of the steering channel is a right turn on this lap: +1 when right
 * is positive (LMU), -1 when left is (iRacing). Read off the lap's own corners,
 * so no sim is assumed: the corners it turned the way the map says sum to a
 * positive number in the right convention. `corners`: [{dir: 1 right, -1 left,
 * peak: the steering sample with the largest size inside the corner}].
 */
export function steerSignOf(corners) {
  let score = 0;
  for (const c of corners) score += c.dir * c.peak;
  return score >= 0 ? 1 : -1;
}

/**
 * The tick where the car turns into a corner: from the peak steering on the
 * corner's side (`sideSign` is +1 or -1 in the channel's own sign), back to the
 * last tick under TURN_IN_FRACTION of that peak. Null when the peak is under
 * the floor, or the wheel never relaxed inside [lowerTick, peak] (the corner is
 * a continuation of the one before; its turn-in is that one's).
 * steer(i) is the channel at tick i.
 */
export function turnInPoint({steer, sideSign, peakFrom, peakTo, lowerTick}) {
  let peak = 0;
  let peakAt = -1;
  for (let i = peakFrom; i <= peakTo; i++) {
    const v = sideSign * steer(i);
    if (v > peak) {
      peak = v;
      peakAt = i;
    }
  }
  if (peakAt < 0 || peak < TURN_IN_FLOOR_PCT) return null;
  const limit = Math.max(TURN_IN_FRACTION * peak, TURN_IN_FLOOR_PCT);
  for (let i = peakAt; i >= lowerTick; i--) {
    if (sideSign * steer(i) < limit) return i;
  }
  return null;
}

/**
 * The throttle's return after a corner's closed phase, from the recorded pedal
 * samples in the stretch (`ticks`, `values[tick]`): the first sample at or
 * above THROTTLE_OPEN_PCT after the last one under THROTTLE_CLOSED_PCT.
 * `minPct` is the lowest pedal in the stretch. A pedal that never closes is a
 * lift, not a pickup: atM null, and minPct says how far it came off.
 */
export function throttlePickup({values, ticks, distAt}) {
  if (!ticks.length) return {atM: null, minPct: null};
  let minPct = Infinity;
  let lastClosed = -1;
  for (let j = 0; j < ticks.length; j++) {
    const v = values[ticks[j]];
    if (v < minPct) minPct = v;
    if (v < THROTTLE_CLOSED_PCT) lastClosed = j;
  }
  if (lastClosed < 0) return {atM: null, minPct};
  for (let j = lastClosed + 1; j < ticks.length; j++) {
    if (values[ticks[j]] >= THROTTLE_OPEN_PCT)
      return {atM: distAt(ticks[j]), minPct};
  }
  return {atM: null, minPct};
}
