// The numbers the chase view's strip shows for the followed car, from the road's measured height profile. Plain
// TypeScript, imports one file.

import {gradeOnLap, heightOnLap, type ChaseRoad} from './chaseRoad.ts';

export interface ChaseHudNumbers {
  /** Grade under the car, percent, + uphill; null on a road without a profile. */
  gradePct: number | null;
  /** Height above the lowest point of the lap, metres; null without a profile. */
  altM: number | null;
}

export function chaseHudNumbers(road: ChaseRoad, lapDistM: number | null): ChaseHudNumbers {
  if (!road.elev || lapDistM === null || !(road.lengthM > 0)) return {gradePct: null, altM: null};
  return {
    gradePct: gradeOnLap(road.elev, lapDistM, road.lengthM) * 100,
    altM: heightOnLap(road.elev, lapDistM, road.lengthM) - road.elevMin,
  };
}

/** "R", "N" or the gear number. */
export function gearLabel(gear: number): string {
  return gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear);
}

/** "+2.1%" / "−0.4%", one decimal, a true minus. */
export function gradeLabel(gradePct: number): string {
  const r = Math.round(gradePct * 10) / 10;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)}%`;
}

export function altitudeLabel(altM: number): string {
  return `${Math.round(altM)} m`;
}

export interface ChaseGapInput {
  /** Seconds to the car ahead in class / the class car behind's interval; null for a leader / a last car. */
  intervalAheadS: number | null;
  intervalBehindS: number | null;
  /** The race clock is before the green flag: the cars stand on the grid. */
  beforeStart: boolean;
}

/** The gaps the strip shows: none before the start (a grid has no gap), otherwise the standings' own intervals. */
export function gapSeconds(i: ChaseGapInput): {aheadS: number | null; behindS: number | null} {
  return i.beforeStart ? {aheadS: null, behindS: null} : {aheadS: i.intervalAheadS, behindS: i.intervalBehindS};
}

export interface ElevationWindow {
  /** Heights at n + 1 evenly spaced points from `behindM` before the car to `aheadM` after it. */
  heights: number[];
  /** Metres between points. */
  stepM: number;
  /** Index of the car's own point. */
  carIndex: number;
  /** The vertical scale: `spanM` metres from `baseM`, at least PROFILE_FLOOR_M so curation noise never fills it like a hill. */
  baseM: number;
  spanM: number;
}

/** The smallest height span the profile strip draws (a 0.4 m wobble stays flat). */
export const PROFILE_FLOOR_M = 10;

export function elevationWindow(
  road: ChaseRoad,
  lapDistM: number,
  behindM: number,
  aheadM: number,
  n: number,
): ElevationWindow | null {
  const elev = road.elev;
  if (!elev || !(road.lengthM > 0)) return null;
  const span = behindM + aheadM;
  const heights: number[] = [];
  for (let i = 0; i <= n; i++) heights.push(heightOnLap(elev, lapDistM - behindM + (span * i) / n, road.lengthM));
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of heights) {
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  const spanM = Math.max(hi - lo, PROFILE_FLOOR_M);
  return {heights, stepM: span / n, carIndex: Math.round((behindM / span) * n), baseM: (hi + lo) / 2 - spanM / 2, spanM};
}
