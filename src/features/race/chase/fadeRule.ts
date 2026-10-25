// Which cars the 3D draws see-through. Pure; the engine applies the answer with `kit.fade`.

/** A car is see-through once nearer the camera than the followed car less this, solid again past it plus FADE_BAND_M. */
const FADE_IN_M = 1;
const FADE_BAND_M = 2;

/**
 * Whether a car is drawn see-through this frame. The followed car never is. With `ghosts` (a qualifying: the other cars
 * are not on the track with you, `carsArePhysical`) every other car is, always. Otherwise a car nearer the camera than
 * the followed one would hide it, so it fades, with a band so it does not flicker at the edge.
 */
export function fadedNow(car: {
  followed: boolean;
  ghosts: boolean;
  wasFaded: boolean;
  /** Camera to this car, and camera to the followed car, in metres. */
  distM: number;
  reachM: number;
}): boolean {
  if (car.followed) return false;
  if (car.ghosts) return true;
  return car.wasFaded
    ? car.distM < car.reachM - FADE_IN_M + FADE_BAND_M
    : car.distM < car.reachM - FADE_IN_M;
}
