// What a car standing on the chase road looks like to the scene: its height, pitch and roll from the road under it.
// The road is one surface (height along the lap, bank across it), so a car takes its pitch from the road's grade and
// its roll from the bank at the same point, and stands on the tilted surface at its lateral offset: a car 3 m to the
// right of the centre line on a 5 degree bank is 0.26 m higher than the centre line, not level with it (the surface
// rises by lateral x tan(roll), so it leans by exactly the roll). Plain
// TypeScript with erasable syntax only.

import type {RoadIndex} from './chaseRoadIndex.ts';

/** Metres either side of the car over which the road's grade is measured. */
const GRADE_SPAN_M = 4;

export interface SurfacePose {
  /** Height of the car's reference point, metres. */
  z: number;
  /** Nose up, radians. */
  pitch: number;
  /** Right side up, radians. */
  roll: number;
}

/** The pose of a car at lap distance `s` and `lateralM` metres right (+) or left (-) of the centre line. */
export function surfacePose(ix: RoadIndex, s: number, lateralM: number): SurfacePose {
  const roll = ix.bankAt(s);
  return {
    z: ix.heightAt(s) + lateralM * Math.tan(roll),
    pitch: Math.atan((ix.heightAt(s + GRADE_SPAN_M) - ix.heightAt(s - GRADE_SPAN_M)) / (2 * GRADE_SPAN_M)),
    roll,
  };
}
