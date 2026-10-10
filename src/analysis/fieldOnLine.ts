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
 * it is used only where the lap distance is missing. iRacing has no lateral, so its cars
 * stay on the line and `placedOnLine` is set.
 *
 * The lap distances, pathLateralM (shared, not copied) and pit state are kept.
 */
/** Beyond this, a car's world x/z is not on the centre path and it is drawn where x/z says. */
export const MAX_PROJECT_M = 30;

/**
 * The nearest point of the closed line to (x, z), searched near the lap distance:
 * along is where the car is on the track, across is the line's right-hand offset.
 * Null when the nearest point is further than MAX_PROJECT_M.
 */
export function projectOnLine(
  line: LinePoint[],
  stepM: number,
  lapDistM: number,
  x: number,
  z: number,
): {x: number; z: number; yawRad: number} | null {
  const n = line.length;
  if (n < 2 || !(stepM > 0) || Number.isNaN(lapDistM)) return null;
  const c = Math.floor(lapDistM / stepM);
  const reach = Math.ceil(MAX_PROJECT_M / stepM) + 1;
  let best: {x: number; z: number; yawRad: number} | null = null;
  let bestD2 = Infinity;
  for (let k = -reach; k <= reach; k++) {
    const i = (((c + k) % n) + n) % n;
    const a = line[i];
    const b = line[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    if (!(L2 > 0)) continue;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.y) * dy) / L2));
    const px = a.x + dx * t;
    const pz = a.y + dy * t;
    const d2 = (x - px) ** 2 + (z - pz) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = {x: px, z: pz, yawRad: Math.atan2(dx, dy)};
    }
  }
  return best && bestD2 <= MAX_PROJECT_M ** 2 ? best : null;
}

/**
 * A copy of the field with every car's position and heading placed on the line.
 *
 * LMU (`lateral`, the line is the measured centre path): the car's world x/z is
 * projected onto the line near its lap distance (where it is along the track),
 * and it is put `pathLateralM` metres to the right of travel from there, as
 * trackSurface.ts measures it (RIGHT = 1). Where lap distance is missing or the
 * projection is over MAX_PROJECT_M away, the car is drawn at its x/z converted
 * as they are (world metres).
 *
 * iRacing (`lateral` false): the car is at its lap distance on the line; the
 * offset stays unknown (NaN), so `placedOnLine` is set.
 *
 * Cars absent at an update stay absent. Lap distances, pathLateralM (shared,
 * not copied) and pit state are kept.
 */
export function placeFieldOnLine(
  field: Field,
  line: LinePoint[],
  stepM: number,
  opts: {
    /** The line is the measured centre path and pathLateralM is off it. */
    lateral: boolean;
  } = {lateral: false},
): Field {
  const {lateral} = opts;
  // The line and the cars are both world metres: x/z is taken as it is.
  const toLine = (x: number, z: number) => ({x, y: z});
  const updates = field.timeS.length;
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
      const d = car.lapDistM[u];
      if (lateral && !Number.isNaN(d) && car.xM[u] === car.xM[u]) {
        const w = toLine(car.xM[u], car.zM[u]);
        const at = projectOnLine(line, stepM, d, w.x, w.y);
        if (at) {
          const off = Number.isFinite(car.pathLateralM[u])
            ? car.pathLateralM[u]
            : 0;
          // Right of travel: the normal is (cos yaw, -sin yaw) in (x, z).
          xM[u] = at.x + off * Math.cos(at.yawRad);
          zM[u] = at.z - off * Math.sin(at.yawRad);
          yawRad[u] = at.yawRad;
          continue;
        }
        xM[u] = w.x;
        zM[u] = w.y;
        yawRad[u] = car.yawRad ? car.yawRad[u] : NaN;
        continue;
      }
      const at = pointOnLine(line, stepM, d);
      if (at) {
        xM[u] = at.x;
        zM[u] = at.z;
        yawRad[u] = at.yawRad;
        continue;
      }
      // No lap distance: the world position is all there is (pit lane, garage).
      if (lateral && car.xM[u] === car.xM[u]) {
        const p = toLine(car.xM[u], car.zM[u]);
        xM[u] = p.x;
        zM[u] = p.y;
        yawRad[u] = car.yawRad ? car.yawRad[u] : NaN;
      }
    }
    return {...car, xM, zM, yawRad, pathLateralM};
  });
  return {...field, cars, hasPositions: true, placedOnLine: !lateral};
}
