// The numbers the chase view's strip shows for the followed car, from the road's measured height profile. Plain
// TypeScript, imports one file.

import {gradeAt, heightAt, type ChaseRoad} from './chaseRoad.ts';

/** Grade steeper than this (rise over run) is drawn as a climb or a drop on the profile. */
export const SLOPE_DRAW = 0.03;

export interface ChaseHudNumbers {
  /** Grade under the car, percent, + uphill; null on a road without a profile. */
  gradePct: number | null;
  /** Height above the lowest point of the lap, metres; null without a profile. */
  altM: number | null;
}

export function chaseHudNumbers(road: ChaseRoad, lapDistM: number | null): ChaseHudNumbers {
  if (!road.elev || lapDistM === null || !(road.lengthM > 0)) return {gradePct: null, altM: null};
  const frac = lapDistM / road.lengthM;
  return {gradePct: gradeAt(road.elev, frac, road.lengthM) * 100, altM: heightAt(road.elev, frac) - road.elevMin};
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
