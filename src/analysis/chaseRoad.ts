// The road the chase view draws, from what the Race screen already has: the
// measured centre path (world metres, one point per surface bin), the measured
// half-widths and the track's curated height profile (read by elevation.ts).
// Plain TypeScript with erasable syntax only.

import {type Elevation, heightOnLap} from './elevation.ts';

/** The curated profile (the track map's `elevation`): heightM[i] at i * stepM metres of a lap of lengthM metres. */
export interface ChaseElevation extends Elevation {
  /** The lap length the profile's distances are measured on (the track map's). */
  lengthM: number;
}

export interface ChaseRoad {
  /** Metres between points along the lap. */
  stepM: number;
  lengthM: number;
  /** The centre path, world metres: x east, y north (the sim's x and z). */
  cx: number[];
  cy: number[];
  /** Half-width to the left and right of the direction of travel, metres. */
  hl: number[];
  hr: number[];
  /** The curated height profile; null on a track without one, where the road is flat. */
  elev: ChaseElevation | null;
  /** The lowest point of `elev` (0 with none), kept once so a frame never scans the profile. */
  elevMin: number;
}

/** Used where no edge was measured on either side. */
export const DEFAULT_HALF_WIDTH_M = 7;

export function chaseRoad(
  centre: {x: number; y: number}[],
  edges: {stepM: number; lengthM: number; leftM: number[]; rightM: number[]} | null,
  stepM: number,
  lengthM: number,
  elevation: {stepM: number; heightM: number[]} | null,
  elevationLapM: number,
): ChaseRoad | null {
  const n = centre.length;
  if (n < 8 || !(stepM > 0)) return null;
  const side = (arr: number[] | undefined, i: number) => {
    const v = arr?.[i];
    return v != null && Number.isFinite(v) && v > 1 ? v : DEFAULT_HALF_WIDTH_M;
  };
  const elev =
    elevation && elevation.heightM.length > 3 && elevation.stepM > 0 && elevationLapM > 0
      ? {stepM: elevation.stepM, heightM: elevation.heightM, lengthM: elevationLapM}
      : null;
  let elevMin = 0;
  if (elev) {
    elevMin = Infinity;
    for (const h of elev.heightM) elevMin = Math.min(elevMin, h);
  }
  return {
    stepM,
    lengthM,
    cx: centre.map(p => p.x),
    cy: centre.map(p => p.y),
    hl: centre.map((_, i) => side(edges?.leftM, i)),
    hr: centre.map((_, i) => side(edges?.rightM, i)),
    elev,
    elevMin,
  };
}

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
