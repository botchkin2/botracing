// The road the chase view draws: the centre path in world metres at equal arc length, the half-widths and the track's
// curated height profile (read by elevation.ts). Built by worldRoad.ts from the field. The type and the profile reads
// live here. Plain TypeScript with erasable syntax only.

import {type Elevation, heightOnLap} from './elevation.ts';

/** The curated profile (the track map's `elevation`): heightM[i] at i * stepM metres of a lap of lengthM metres. */
export interface ChaseElevation extends Elevation {
  /** The lap length the profile's distances are measured on (the track map's). */
  lengthM: number;
}

export interface ChaseRoad {
  /** Metres between points along the path: equal for every pair, so a distance along the road is metres, not bins. */
  stepM: number;
  /** The path's own length in metres (stepM x points). */
  lengthM: number;
  /** The lap as the game's lap distance measures it (the surface's length): what a car's lapDistM and the curated profile are read on. */
  lapM: number;
  /** The centre path, world metres: x east, y north (the sim's x and z). */
  cx: number[];
  cy: number[];
  /** Half-width to the left and right of the direction of travel, metres. */
  hl: number[];
  hr: number[];
  /** The curated height profile; null on a track without one, where the road is flat. */
  elev: ChaseElevation | null;
  /** The profile's height at each path point; null without a profile. */
  heightM: number[] | null;
  /** The lowest point of `elev` (0 with none), kept once so a frame never scans the profile. */
  elevMin: number;
  /** The road's roll at each path point, degrees, + with the right side of travel up (the curated `bank`); null without one, where the road is level across. */
  bankDeg: number[] | null;
}

/** Used where no edge was measured on either side. */
export const DEFAULT_HALF_WIDTH_M = 7;

/**
 * The road's height at `roadM` metres of the road's own lap, read on the profile's lap (the two are the same lap
 * measured by two tools, so the distance is scaled by their lengths). Wraps (elevation.ts heightOnLap).
 */
export function roadHeight(elev: ChaseElevation, roadM: number, roadLengthM: number): number {
  return heightOnLap(elev, roadM * (elev.lengthM / roadLengthM), elev.lengthM);
}

/** Grade (rise over run on the profile's own metres, + uphill) at `roadM`, over `spanM` metres of road. */
export function roadGrade(elev: ChaseElevation, roadM: number, roadLengthM: number, spanM = 12): number {
  const rise = roadHeight(elev, roadM + spanM / 2, roadLengthM) - roadHeight(elev, roadM - spanM / 2, roadLengthM);
  return rise / (spanM * (elev.lengthM / roadLengthM));
}
