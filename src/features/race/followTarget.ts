import {type FollowView, headingRad} from '@/src/analysis/followView';
import {type RaceCar} from '@/src/analysis/raceState';
import {type MapPlacer} from '@/src/data/sessions';

/**
 * Track length that fills the map's height at zoom 1x: 120 m, the same start
 * as Compare on the phone (round 5, item 5; it was 300 m, pit-wall thread 27
 * #1041). The − / + steps are 0.6, 1 and 1.7 of it.
 */
export const RACE_FOLLOW_M = 120;

// How far ahead of the car the heading is measured. The car's yaw is a
// direction in game-world axes; placing a point this far along it through the
// map's own projection and georef gives the direction on the map, so the
// georef's rotation never has to be known here.
const AHEAD_M = 10;

/**
 * The car Follow chases: the focused car, else you. Null when it is not on
 * the map or its file has no heading (field files before v2).
 */
export function followCar(
  cars: RaceCar[],
  focus: number | null,
): RaceCar | null {
  const usable = (c: RaceCar | undefined) =>
    c !== undefined && c.state !== 'garage' && c.headingRad !== null ? c : null;
  const focused =
    focus == null ? null : usable(cars.find(c => c.index === focus));
  return focused ?? usable(cars.find(c => c.player));
}

/** Where the chase view sits and which way it points, in map metres. */
export function followViewFor(
  placer: MapPlacer,
  car: RaceCar,
  visibleM: number,
): Omit<FollowView, 'width' | 'height'> | null {
  if (car.headingRad === null) return null;
  const [at, ahead] = placer.placeWorld([
    {x: car.xM, z: car.zM},
    {
      x: car.xM + Math.sin(car.headingRad) * AHEAD_M,
      z: car.zM + Math.cos(car.headingRad) * AHEAD_M,
    },
  ]);
  return {centre: at, headingRad: headingRad(at, ahead), visibleM};
}
