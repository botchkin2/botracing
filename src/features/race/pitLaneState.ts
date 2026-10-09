import {onPitLane} from '@/src/analysis/pitLane';
import {type RaceCar} from '@/src/analysis/raceState';
import {type MapPlacer} from '@/src/data/sessions';

/**
 * Cars the off-track rule calls "off" that are on the pit lane are in the pit
 * lane. The game's in-pits flag is 0 for the whole field parked on the pit road
 * at the start of a race, and that road is ~9 m from the racing line, past the
 * 7.5 m off-track limit (Botkin's desktop test, pit-wall thread 27 #917).
 * Only the "off" cars are placed on the map, so this is a handful of points a
 * frame, not the whole field.
 */
export function markPitLane(cars: RaceCar[], placer: MapPlacer): RaceCar[] {
  if (placer.pitLane.length === 0) return cars;
  const off = cars.filter(c => c.state === 'off');
  if (off.length === 0) return cars;
  const placed = placer.placeWorld(off.map(c => ({x: c.xM, z: c.zM})));
  const onLane = new Set(
    off
      .filter((_, i) => onPitLane(placed[i], placer.pitLane))
      .map(c => c.index),
  );
  if (onLane.size === 0) return cars;
  // Before anyone has taken the start, the pit road is the grid, not a stop
  // (Daytona 9b16b76, 2 Oct Road Atlanta: PIT on 18–38 cars in formation).
  const started = cars.some(c => c.lapsDone > 0);
  return cars.map(c =>
    onLane.has(c.index)
      ? {...c, state: started ? ('pit' as const) : ('running' as const)}
      : c,
  );
}
