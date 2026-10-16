// Seconds a lap spends coasting: throttle and brake both off with the car above
// walking pace. The measure of pit-wall thread 72 (plank #5726, final): a
// stint-to-stint difference, never "coast = saving" (it includes the normal
// lift through fast corners). From the archived channels in both flows and both
// sims. The constants are named here and nowhere else.
export const COAST_PEDAL_PCT = 5;
export const COAST_MIN_KMH = 80;
export const COAST_VERSION = 1;

/**
 * @param {{t: ArrayLike<number>, speed_kmh: ArrayLike<number>, throttle_pct: ArrayLike<number>, brake_pct: ArrayLike<number>}} s
 * @returns {number|null} seconds over samples i0..i1 (each sample owns the time since the one before); null without the channels
 */
export function coastSeconds(s, i0, i1) {
  if (!s.throttle_pct || !s.brake_pct || !s.speed_kmh) return null;
  let sum = 0;
  for (let i = i0 + 1; i <= i1; i++) {
    if (
      s.throttle_pct[i] < COAST_PEDAL_PCT &&
      s.brake_pct[i] < COAST_PEDAL_PCT &&
      s.speed_kmh[i] > COAST_MIN_KMH
    )
      sum += s.t[i] - s.t[i - 1];
  }
  return Math.round(sum * 100) / 100;
}
