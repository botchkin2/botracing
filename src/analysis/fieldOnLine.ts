// A field with lap distances but no positions (iRacing's), placed on a line.
//
// iRacing: placed by lap distance, not position. Every car is put at its lap
// distance on the track's reference line (the player's best lap, drawn as map
// metres). Along the track that is exact; across it nothing is known, so every
// car sits on the line, not offset from it. The result is for drawing and for
// ordering, never evidence of where a car really was (pit-wall thread 1,
// #2962, #2963). The stored field keeps its positions absent.
//
// Plain TypeScript with erasable syntax only: Node can run it.

import {type Field, type FieldCar} from './field';

/** A point of the line, in map metres, spaced `stepM` of lap distance apart. */
export interface LinePoint {
  x: number;
  y: number;
}

/**
 * The line at `lapDistM`, as the map metres the placer draws in (x, and y as
 * the world's z), with the heading of the line there (0 along +z, π/2 along
 * +x, the Field convention). The line is one closed lap: point i is at
 * i * stepM, and the last joins the first.
 */
export function pointOnLine(
  line: LinePoint[],
  stepM: number,
  lapDistM: number,
): {x: number; z: number; yawRad: number} | null {
  const n = line.length;
  if (n < 2 || !(stepM > 0) || Number.isNaN(lapDistM)) return null;
  const lengthM = n * stepM;
  const d = ((lapDistM % lengthM) + lengthM) % lengthM;
  const i = Math.floor(d / stepM);
  const f = d / stepM - i;
  const a = line[i % n];
  const b = line[(i + 1) % n];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    x: a.x + dx * f,
    z: a.y + dy * f,
    yawRad: Math.atan2(dx, dy),
  };
}

/**
 * A copy of the field with every car's position and heading taken from the
 * line at its lap distance, `hasPositions` true so the screens draw it. Cars
 * absent at an update (NaN lap distance) stay absent.
 *
 * LMU (`hasPositions`): the car is put `pathLateralM` metres to the right of
 * the line's direction of travel, as trackSurface.ts measures it (RIGHT = 1),
 * so a car is on the drawn road when the game says it is. The recorder's own
 * x/z sits about 8 m off the road at Road Atlanta's T7 (pit-wall #3833), so
 * it is used only where the lap distance is missing: `worldToMap` converts
 * those world metres to the line's frame. iRacing has no lateral, so its cars
 * stay on the line and `placedOnLine` is set.
 *
 * The lap distances, pathLateralM (shared, not copied) and pit state are kept.
 */
export function placeFieldOnLine(
  field: Field,
  line: LinePoint[],
  stepM: number,
  worldToMap?: (x: number, z: number) => {x: number; y: number},
): Field {
  const updates = field.timeS.length;
  const lateral = field.hasPositions;
  const cars: FieldCar[] = field.cars.map(car => {
    const xM = new Float32Array(updates).fill(NaN);
    const zM = new Float32Array(updates).fill(NaN);
    const yawRad = new Float32Array(updates).fill(NaN);
    // iRacing's offset stays unknown (NaN), never 0: the lanes and the
    // off-track state read it, and 0 would claim every car is in your lane.
    const pathLateralM = lateral
      ? car.pathLateralM
      : new Float32Array(updates).fill(NaN);
    for (let u = 0; u < updates; u++) {
      const at = pointOnLine(line, stepM, car.lapDistM[u]);
      if (at) {
        // Right of travel: the line's normal is (cos yaw, -sin yaw) in (x, z).
        // A lateral NaN (a sample with no lateral) puts the car on the line.
        const off =
          lateral && Number.isFinite(car.pathLateralM[u])
            ? car.pathLateralM[u]
            : 0;
        xM[u] = at.x + off * Math.cos(at.yawRad);
        zM[u] = at.z - off * Math.sin(at.yawRad);
        yawRad[u] = at.yawRad;
        continue;
      }
      // No lap distance: the world position is all there is (pit lane, garage).
      if (lateral && worldToMap && car.xM[u] === car.xM[u]) {
        const p = worldToMap(car.xM[u], car.zM[u]);
        xM[u] = p.x;
        zM[u] = p.y;
        yawRad[u] = car.yawRad ? car.yawRad[u] : NaN;
      }
    }
    return {...car, xM, zM, yawRad, pathLateralM};
  });
  return {...field, cars, hasPositions: true, placedOnLine: !lateral};
}
