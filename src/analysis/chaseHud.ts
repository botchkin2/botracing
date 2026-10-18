// The numbers the chase view's strip shows for the followed car, from the road's measured height profile. Plain
// TypeScript, imports one file.

import {gradeAt, heightAt} from './chaseRoad.ts';

/** Grade steeper than this (rise over run) is drawn as a climb or a drop on the profile. */
export const SLOPE_DRAW = 0.03;

export interface ChaseHudNumbers {
  /** Grade under the car, percent, + uphill; null on a road without a profile. */
  gradePct: number | null;
  /** Height above the lowest point of the lap, metres; null without a profile. */
  altM: number | null;
}

export function chaseHudNumbers(elev: number[] | null, lapDistM: number | null, lengthM: number): ChaseHudNumbers {
  if (!elev || lapDistM === null || !(lengthM > 0)) return {gradePct: null, altM: null};
  const frac = lapDistM / lengthM;
  let lowest = Infinity;
  for (const z of elev) lowest = Math.min(lowest, z);
  return {gradePct: gradeAt(elev, frac, lengthM) * 100, altM: heightAt(elev, frac) - lowest};
}

export interface ElevationWindow {
  /** Heights at n + 1 evenly spaced points from `behindM` before the car to `aheadM` after it. */
  heights: number[];
  /** Metres between points. */
  stepM: number;
  /** Index of the car's own point. */
  carIndex: number;
}

export function elevationWindow(
  elev: number[],
  lapDistM: number,
  lengthM: number,
  behindM: number,
  aheadM: number,
  n: number,
): ElevationWindow {
  const span = behindM + aheadM;
  const frac = lapDistM / lengthM;
  const heights: number[] = [];
  for (let i = 0; i <= n; i++) heights.push(heightAt(elev, frac - behindM / lengthM + (span / lengthM) * (i / n)));
  return {heights, stepM: span / n, carIndex: Math.round((behindM / span) * n)};
}

/** Whether a stretch of the profile climbs, drops or is level, for its colour. */
export function slopeKind(grade: number): 'up' | 'down' | 'flat' {
  return grade > SLOPE_DRAW ? 'up' : grade < -SLOPE_DRAW ? 'down' : 'flat';
}
