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
}

/** Used where no edge was measured on either side. */
export const DEFAULT_HALF_WIDTH_M = 7;

/** Metres between the points of the road: close enough that a straight piece between two is a curve to the eye. */
export const ROAD_STEP_M = 2;
const SUBDIVISIONS = 16;

/**
 * Point and bin position along a chordal Catmull-Rom curve through `pts` (closed), `SUBDIVISIONS` per segment.
 * Through the points; chord-length knots keep a circle round when the spacing is uneven, which is what bin means have.
 */
function smoothThrough(pts: {x: number; y: number}[]): {x: number[]; y: number[]; bin: number[]} {
  const n = pts.length;
  const x: number[] = [];
  const y: number[] = [];
  const bin: number[] = [];
  const knot = (t: number, a: {x: number; y: number}, b: {x: number; y: number}) => t + Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1e-6);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const t0 = 0;
    const t1 = knot(t0, p0, p1);
    const t2 = knot(t1, p1, p2);
    const t3 = knot(t2, p2, p3);
    for (let k = 0; k < SUBDIVISIONS; k++) {
      const t = t1 + ((t2 - t1) * k) / SUBDIVISIONS;
      // Barry-Goldman pyramid
      const mix = (a: {x: number; y: number}, b: {x: number; y: number}, ta: number, tb: number) => {
        const w = (t - ta) / (tb - ta);
        return {x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w};
      };
      const a1 = mix(p0, p1, t0, t1);
      const a2 = mix(p1, p2, t1, t2);
      const a3 = mix(p2, p3, t2, t3);
      const b1 = mix(a1, a2, t0, t2);
      const b2 = mix(a2, a3, t1, t3);
      const c = mix(b1, b2, t1, t2);
      x.push(c.x);
      y.push(c.y);
      bin.push(i + k / SUBDIVISIONS);
    }
  }
  return {x, y, bin};
}

/**
 * The surface's bins are 10 m of the game's lap distance, but the centre path through their mean positions is not: its
 * points sit 8.5 to 12.2 m apart (Road Atlanta), so "10 m behind the car" along it was anything from 8.5 to 12.2 m,
 * and 10 m chords turned a 30 m hairpin in 19 degree steps. The path is resampled once, on a smooth curve through the
 * means, to equal arc length (`ROAD_STEP_M`), so every distance along it is metres and a bend is round. A point keeps
 * what the bin it came from held: its width (between the two bins either side) and its curated height.
 */
export function chaseRoad(
  centre: {x: number; y: number}[],
  edges: {stepM: number; lengthM: number; leftM: number[]; rightM: number[]} | null,
  stepM: number,
  lengthM: number,
  elevation: {stepM: number; heightM: number[]} | null,
  elevationLapM: number,
): ChaseRoad | null {
  const bins = centre.length;
  if (bins < 8 || !(stepM > 0)) return null;
  const side = (arr: number[] | undefined, i: number) => {
    const v = arr?.[i % bins];
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
  const dense = smoothThrough(centre);
  const m = dense.x.length;
  const arc = new Float64Array(m + 1);
  for (let j = 0; j < m; j++) arc[j + 1] = arc[j] + Math.hypot(dense.x[(j + 1) % m] - dense.x[j], dense.y[(j + 1) % m] - dense.y[j]);
  const pathM = arc[m];
  if (!(pathM > 0)) return null;
  const n = Math.max(8, Math.round(pathM / ROAD_STEP_M));
  const step = pathM / n;
  const binLapM = bins * stepM;
  const cx: number[] = [];
  const cy: number[] = [];
  const hl: number[] = [];
  const hr: number[] = [];
  const heightM: number[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (j < m - 1 && arc[j + 1] <= target) j++;
    const span = arc[j + 1] - arc[j];
    const raw = span > 0 ? (target - arc[j]) / span : 0;
    const t = raw < 1e-9 ? 0 : raw;
    const j2 = (j + 1) % m;
    cx.push(dense.x[j] + (dense.x[j2] - dense.x[j]) * t);
    cy.push(dense.y[j] + (dense.y[j2] - dense.y[j]) * t);
    // the bin position of this point, between the two samples either side (the second wraps to the lap's start)
    const b1 = j2 === 0 ? bins : dense.bin[j2];
    const at = dense.bin[j] + (b1 - dense.bin[j]) * t;
    const i = Math.floor(at);
    const f = at - i;
    hl.push(side(edges?.leftM, i) + (side(edges?.leftM, i + 1) - side(edges?.leftM, i)) * f);
    hr.push(side(edges?.rightM, i) + (side(edges?.rightM, i + 1) - side(edges?.rightM, i)) * f);
    if (elev) heightM.push(roadHeight(elev, at * stepM, binLapM));
  }
  return {stepM: step, lengthM: pathM, lapM: lengthM, cx, cy, hl, hr, elev, heightM: elev ? heightM : null, elevMin};
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
