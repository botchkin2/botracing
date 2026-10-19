// The road the chase view draws, from what the Race screen already has: the
// measured centre path (world metres, one point per surface bin), the measured
// half-widths and the track's curated height profile. Plain TypeScript with
// erasable syntax only, no imports.

/** The curated profile (the track map's `elevation`): heightM[i] at i * stepM metres of a lap of lengthM metres. */
export interface ChaseElevation {
  stepM: number;
  heightM: number[];
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
 * measured by two tools, so the distance is scaled by their lengths). Wraps: past the last point the height runs
 * back to the first.
 */
export function heightOnLap(elev: ChaseElevation, roadM: number, roadLengthM: number): number {
  const m = (((roadM * (elev.lengthM / roadLengthM)) % elev.lengthM) + elev.lengthM) % elev.lengthM;
  const h = elev.heightM;
  const last = h.length - 1;
  const f = m / elev.stepM;
  if (f < last) {
    const i = Math.floor(f);
    return h[i] + (h[i + 1] - h[i]) * (f - i);
  }
  const tail = elev.lengthM - last * elev.stepM;
  const t = tail > 0 ? Math.min(1, (m - last * elev.stepM) / tail) : 0;
  return h[last] + (h[0] - h[last]) * t;
}

/** Grade (rise over run on the profile's own metres, + uphill) at `roadM`, over `spanM` metres of road. */
export function gradeOnLap(elev: ChaseElevation, roadM: number, roadLengthM: number, spanM = 12): number {
  const rise = heightOnLap(elev, roadM + spanM / 2, roadLengthM) - heightOnLap(elev, roadM - spanM / 2, roadLengthM);
  return rise / (spanM * (elev.lengthM / roadLengthM));
}
