// Which way a car points in the chase view. The stored yaw is the game's own and is the answer wherever it exists:
// measured on his Portimao practice and Silverstone race it is within 10 degrees of the car's travel on 99.9 % of
// moving frames, and the frames beyond 50 degrees (16 of 41 334 on Silverstone, none on Portimao) are a car spinning,
// which is real. Only a yaw pointing the opposite way to both the road and the car's travel is treated as a flipped
// sample. Plain TypeScript, imports one file.

import {angDiff} from './chaseMath.ts';

/** A stored yaw this far (radians, 150 degrees) from both the road tangent and the direction of travel points the wrong way round. */
export const FLIP_LIMIT_RAD = 2.6;
/** Below this speed the direction of travel is noise. */
export const TRAVEL_MIN_KMH = 8;

export interface HeadingInput {
  /** The stored yaw as a world angle (0 along +x, counter-clockwise), null in files without one. */
  gameYaw: number | null;
  /** The road's direction at the car, null with no road near. */
  tangent: number | null;
  /** The smoothed direction between recent positions, null until two are known. */
  travel: number | null;
  speedKmh: number;
  onRoad: boolean;
}

/** The angle to draw the car at. */
export function chaseHeading(i: HeadingInput): number {
  const {gameYaw: yaw, tangent, travel} = i;
  if (
    yaw !== null &&
    (!i.onRoad ||
      tangent === null ||
      Math.abs(angDiff(yaw, tangent)) < FLIP_LIMIT_RAD ||
      (travel !== null && Math.abs(angDiff(yaw, travel)) < FLIP_LIMIT_RAD))
  )
    return yaw;
  if (travel !== null && i.speedKmh > TRAVEL_MIN_KMH) return travel;
  return tangent ?? yaw ?? 0;
}

/**
 * The direction of travel after a move of (dx, dy) metres: halfway to the new bearing, forgotten after a jump
 * (a teleport to the pits), held through a move too short to give a bearing.
 */
export function stepTravel(travel: number | null, dx: number, dy: number): number | null {
  const d = Math.hypot(dx, dy);
  if (d > 40) return null;
  if (d <= 0.25) return travel;
  const bearing = Math.atan2(dy, dx);
  return travel === null ? bearing : travel + angDiff(travel, bearing) * 0.5;
}
