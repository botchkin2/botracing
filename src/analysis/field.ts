// The whole field of a session: every car at 5 Hz, decoded from the upload
// (docs/API.md, GET /sessions/{id}/field/{hash}; written by
// tools/sessions/field.mjs). Struct of arrays: one array per channel per car,
// all the length of `timeS`.
//
// Plain TypeScript with erasable syntax only, no imports: Node can run it.

/**
 * Marks "car absent at this update" in the integer channels. Real values are
 * never negative (place from 1, laps and flag from 0, inPits 0 or 1). The
 * float channels use NaN for the same thing: test with `Number.isNaN`.
 */
export const ABSENT = -1;

// Typed arrays, not number[]: an hour of 62 cars is about 10 million values,
// and plain arrays of boxed numbers would hold the phone at several hundred
// MB (camber, pit wall thread 30 #807). Float32 keeps decimetre positions to
// about a millimetre across a 10 km track.
export interface FieldCar {
  /** Index in the file; stable within one session only. */
  index: number;
  /** LMU's class ("GT3", "Hyper", "LMP2"); empty when not recorded. */
  carClass: string;
  /** The car model from the recorder's map, never an entry name; null when unknown. */
  vehicle: string | null;
  /** The uploader's own car. Exactly one per field. */
  player: boolean;
  /** Distance along the lap, metres. NaN where the car was absent. */
  lapDistM: Float32Array;
  /** Offset from the track's path, metres. */
  pathLateralM: Float32Array;
  /** The sim's world coordinates, metres (not the trace Lat/Lon). */
  xM: Float32Array;
  zM: Float32Array;
  /**
   * Heading, radians, wrapped to ±π: 0 along +z, π/2 along +x (the direction
   * of atan2(Δx, Δz)). Null for files before v2, which carry none.
   */
  yawRad: Float32Array | null;
  /** Overall race position at each update; ABSENT where the car was. */
  place: Int16Array;
  /** Laps completed. */
  lapsDone: Int16Array;
  /** 1 in the pits, 0 out; ABSENT where the car was absent. */
  inPits: Int8Array;
  /** The car's flag state (LMU's `mFlag`; 6 is a blue flag). */
  flag: Int16Array;
}

export interface Field {
  /** File version: 1 has no heading. */
  version: number;
  hz: number;
  /**
   * Whether the cars have world positions (xM, zM). LMU's do; iRacing gives lap
   * distance only, so its x and z are all NaN and anything that draws or
   * measures by position (the map dots, the radar, the lanes) must leave the
   * field alone. Set by the decoder from the data, never from the sim's name.
   */
  hasPositions: boolean;
  /**
   * Set only by `placeFieldOnLine`: the positions were put on the track line by
   * lap distance, so how far apart two cars are across the track is not known.
   * Anything that shows beside-or-not (the radar) must be left out.
   */
  placedOnLine?: boolean;
  /** Session clock at the first update, seconds. */
  startEtS: number;
  /** Seconds from the first update, one per update. */
  timeS: Float64Array;
  cars: FieldCar[];
}

/**
 * The update nearest to `timeS`, clamped to the ends; -1 for an empty field.
 * `times` is ascending (Field.timeS).
 */
export function updateAt(times: ArrayLike<number>, timeS: number): number {
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
