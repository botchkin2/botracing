// Lookups on the chase road: by lap distance (height, width, direction, curvature) and by world position (the nearest
// point of the centre path). Built once per road. Plain TypeScript, imports two files.

import {angDiff, clamp, lerp, mod} from './chaseMath.ts';
import type {ChaseRoad} from './chaseRoad.ts';

const CELL_M = 100;
const cellKey = (a: number, b: number) => a * 100003 + b;

export interface NearestRoad {
  /** Metres from the position to the centre path. */
  dist: number;
  /** Lap distance of the nearest point. */
  s: number;
  /** +1 on the right of the direction of travel, -1 on the left. */
  side: 1 | -1;
}

export interface RoadIndex {
  /** Metres between points; equal for all, so a lap distance `s` on this index is metres along the path. */
  stepM: number;
  lengthM: number;
  /** The road as the game's lap distance measures it, for turning a car's lapDistM into `s`. */
  lapM: number;
  /** The centre path, world metres, one point per bin. */
  centreX: ArrayLike<number>;
  centreY: ArrayLike<number>;
  /** Per-point direction of travel (radians), right-hand normal and height. */
  heading: Float64Array;
  normalX: Float64Array;
  normalY: Float64Array;
  height: Float64Array;
  /** Whether the road carries a measured height profile (otherwise all heights are 0). */
  hasHeight: boolean;
  heightAt(s: number): number;
  widthAt(s: number, side: number): number;
  curvatureAt(s: number): number;
  tangentAt(s: number): number;
  /** The nearest centre-path point within `reach` grid cells (100 m each), or null. */
  nearest(x: number, y: number, reach?: number): NearestRoad | null;
}

export function roadIndex(road: ChaseRoad): RoadIndex {
  const n = road.cx.length;
  const bin = road.stepM;
  const heading = new Float64Array(n);
  const normalX = new Float64Array(n);
  const normalY = new Float64Array(n);
  const curv = new Float64Array(n);
  const height = new Float64Array(n);
  const grid = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    heading[i] = Math.atan2(road.cy[b] - road.cy[a], road.cx[b] - road.cx[a]);
    normalX[i] = Math.sin(heading[i]);
    normalY[i] = -Math.cos(heading[i]);
    const key = cellKey(Math.floor(road.cx[i] / CELL_M), Math.floor(road.cy[i] / CELL_M));
    const cell = grid.get(key);
    if (cell) cell.push(i);
    else grid.set(key, [i]);
  }
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -3; k < 3; k++) sum += angDiff(heading[mod(i + k, n)], heading[mod(i + k + 1, n)]);
    curv[i] = sum / (6 * bin);
  }
  // Height only where the track has its curated profile; otherwise the road is flat at 0.
  const hasHeight = road.heightM !== null;
  if (road.heightM) for (let i = 0; i < n; i++) height[i] = road.heightM[i];
  const between = (s: number): [number, number, number] => {
    const f = mod(s / bin, n);
    const i = Math.floor(f);
    return [i, (i + 1) % n, f - i];
  };
  const at = (arr: ArrayLike<number>, s: number) => {
    const [i, j, t] = between(s);
    return lerp(arr[i], arr[j], t);
  };
  return {
    stepM: bin,
    lengthM: n * bin,
    lapM: road.lapM,
    centreX: road.cx,
    centreY: road.cy,
    heading,
    normalX,
    normalY,
    height,
    hasHeight,
    heightAt: s => at(height, s),
    widthAt: (s, side) => at(side < 0 ? road.hl : road.hr, s),
    curvatureAt: s => at(curv, s),
    tangentAt(s) {
      const [i, j, t] = between(s);
      return Math.atan2(
        lerp(Math.sin(heading[i]), Math.sin(heading[j]), t),
        lerp(Math.cos(heading[i]), Math.cos(heading[j]), t),
      );
    },
    nearest(x, y, reach = 3) {
      const cx0 = Math.floor(x / CELL_M);
      const cy0 = Math.floor(y / CELL_M);
      let best = Infinity;
      let bestS = 0;
      let bestSide: 1 | -1 = 1;
      for (let a = -reach; a <= reach; a++) {
        for (let b = -reach; b <= reach; b++) {
          const cell = grid.get(cellKey(cx0 + a, cy0 + b));
          if (!cell) continue;
          for (const i of cell) {
            const j = (i + 1) % n;
            const dx = road.cx[j] - road.cx[i];
            const dy = road.cy[j] - road.cy[i];
            const t = clamp(((x - road.cx[i]) * dx + (y - road.cy[i]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
            const px = road.cx[i] + dx * t;
            const py = road.cy[i] + dy * t;
            const d2 = (x - px) ** 2 + (y - py) ** 2;
            if (d2 < best) {
              best = d2;
              bestS = (i + t) * bin;
              bestSide = (x - px) * normalX[i] + (y - py) * normalY[i] >= 0 ? 1 : -1;
            }
          }
        }
      }
      return best === Infinity ? null : {dist: Math.sqrt(best), s: bestS, side: bestSide};
    },
  };
}
