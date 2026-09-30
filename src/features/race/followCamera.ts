import {headingRad} from '@/src/analysis/followView';
import {type RaceCar} from '@/src/analysis/raceState';
import {type MapPlacer, type Xy} from '@/src/data/sessions';

// The Race map's Follow view (like Compare's, handoff v2 M1b): which car the
// camera sits on and which way it faces. Pure; the map draws it.

export type FollowCamera = {centre: Xy; headingRad: number};

// A car's heading is measured on the map, not turned by a formula: a point
// this far ahead of it (yaw 0 is +z, atan2(dx, dz), as in Field.yawRad) goes
// through the same projection and georef as the car, so the map's rotation
// comes for free.
const AHEAD_M = 10;

/**
 * The camera on the focused car, else on you. Null when that car is in the
 * garage or the field carries no yaw for it: the map then draws the Track.
 */
export function followCamera(
  placer: MapPlacer,
  cars: RaceCar[],
  focus: number | null,
): FollowCamera | null {
  const car =
    (focus == null ? undefined : cars.find(c => c.index === focus)) ??
    cars.find(c => c.player);
  if (!car || car.state === 'garage' || car.headingRad == null) return null;
  const [from, to] = placer.placeWorld([
    {x: car.xM, z: car.zM},
    {
      x: car.xM + Math.sin(car.headingRad) * AHEAD_M,
      z: car.zM + Math.cos(car.headingRad) * AHEAD_M,
    },
  ]);
  return {centre: from, headingRad: headingRad(from, to)};
}
