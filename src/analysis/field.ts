// The whole field of a session: every car at 5 Hz, decoded from the upload
// (docs/API.md, GET /sessions/{id}/field/{hash}; written by
// tools/sessions/field.mjs). Struct of arrays: one array per channel per car,
// all the length of `timeS`.
//
// Plain TypeScript with erasable syntax only, no imports: Node can run it.

export interface FieldCar {
  /** Index in the file; stable within one session only. */
  index: number;
  /** LMU's class ("GT3", "Hyper", "LMP2"); empty when not recorded. */
  carClass: string;
  /** The car model from the recorder's map, never an entry name; null when unknown. */
  vehicle: string | null;
  /** The uploader's own car. Exactly one per field. */
  player: boolean;
  /** Distance along the lap, metres. Null where the car was absent. */
  lapDistM: (number | null)[];
  /** Offset from the track's path, metres. */
  pathLateralM: (number | null)[];
  /** The sim's world coordinates, metres (not the trace Lat/Lon). */
  xM: (number | null)[];
  zM: (number | null)[];
  /**
   * Heading, radians, wrapped to ±π: 0 along +z, π/2 along +x (the direction
   * of atan2(Δx, Δz)). Null for files before v2, which carry none.
   */
  yawRad: (number | null)[] | null;
  /** Overall race position at each update. */
  place: (number | null)[];
  /** Laps completed. */
  lapsDone: (number | null)[];
  inPits: (boolean | null)[];
  /** The car's flag state (LMU's `mFlag`; 6 is a blue flag). */
  flag: (number | null)[];
}

export interface Field {
  /** File version: 1 has no heading. */
  version: number;
  hz: number;
  /** Session clock at the first update, seconds. */
  startEtS: number;
  /** Seconds from the first update, one per update. */
  timeS: number[];
  cars: FieldCar[];
}

/** Inverse of the upload's delta step: running sums, nulls kept as nulls. */
export function undelta(deltas: (number | null)[]): (number | null)[] {
  let sum = 0;
  const out: (number | null)[] = [];
  for (const d of deltas) {
    if (d === null) {
      out.push(null);
    } else {
      sum += d;
      out.push(sum);
    }
  }
  return out;
}

/**
 * The update nearest to `timeS`, clamped to the ends; -1 for an empty field.
 * `times` is ascending (Field.timeS).
 */
export function updateAt(times: number[], timeS: number): number {
  if (times.length === 0) return -1;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < timeS) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && timeS - times[lo - 1] < times[lo] - timeS ? lo - 1 : lo;
}
