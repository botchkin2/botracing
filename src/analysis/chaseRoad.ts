// The road the chase view draws, from what the Race screen already has: the
// measured centre path (world metres, one point per surface bin) and the
// measured half-widths. Plain TypeScript with erasable syntax only, no imports.

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
  /** Height of the road surface along the lap, metres, by lap fraction (wraps); null with none. */
  elev: number[] | null;
}

/** Used where no edge was measured on either side. */
export const DEFAULT_HALF_WIDTH_M = 7;

export function chaseRoad(
  centre: {x: number; y: number}[],
  edges: {stepM: number; lengthM: number; leftM: number[]; rightM: number[]} | null,
  stepM: number,
  lengthM: number,
  elev: number[] | null,
): ChaseRoad | null {
  const n = centre.length;
  if (n < 8 || !(stepM > 0)) return null;
  const side = (arr: number[] | undefined, i: number) => {
    const v = arr?.[i];
    return v != null && Number.isFinite(v) && v > 1 ? v : DEFAULT_HALF_WIDTH_M;
  };
  return {
    stepM,
    lengthM,
    cx: centre.map(p => p.x),
    cy: centre.map(p => p.y),
    hl: centre.map((_, i) => side(edges?.leftM, i)),
    hr: centre.map((_, i) => side(edges?.rightM, i)),
    elev: elev && elev.length > 3 ? elev : null,
  };
}

/** Height at a lap fraction, linear between the stored points, wrapping. */
export function heightAt(elev: number[], fraction: number): number {
  const f = (((fraction % 1) + 1) % 1) * elev.length;
  const i = Math.floor(f);
  const t = f - i;
  return elev[i % elev.length] * (1 - t) + elev[(i + 1) % elev.length] * t;
}

/** Grade at a lap fraction over `spanM` metres (rise over run, + uphill). */
export function gradeAt(elev: number[], fraction: number, lengthM: number, spanM = 12): number {
  const d = spanM / lengthM;
  return (heightAt(elev, fraction + d / 2) - heightAt(elev, fraction - d / 2)) / spanM;
}
