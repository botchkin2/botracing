// How the road is used, from the cars that drove it (thread 94 #6419, LMU footage): where across the road the cars
// run (the rubbered line the game paints darker), and the stretches where cars keep touching an edge (a kerb). Every
// number is the field's own: each moving car sample has a lap distance and a lateral offset from the centre line
// (pathLateralM, right positive), and the road has measured half-widths per point. Plain TypeScript, no imports.

/** Columns across the road, left edge to right edge. */
export const USE_COLUMNS = 32;
/** The along-road smoothing, metres each way: a line is a few cars' worth of laps, not a single pass. */
const SMOOTH_M = 12;
/** A car within this of an edge, or past it, is touching it. */
const TOUCH_M = 0.6;
/** A kerb: at least this share of the cars near that point touch the edge. */
export const KERB_SHARE = 0.03;
/** The fewest samples within the smoothing window for a share to mean anything. */
const MIN_SAMPLES = 20;

export interface RoadUse {
  /** USE_COLUMNS values per road point, 0 where cars never ran to 1 on the busiest column of that point. */
  shade: Float32Array;
  /** Per road point: cars touch the left / right edge here (kerb). */
  kerbLeft: Uint8Array;
  kerbRight: Uint8Array;
}

export interface UseSamples {
  /** Lap distance of each sample, metres in [0, lapM). */
  ld: ArrayLike<number>;
  /** Lateral offset from the centre line, metres, right of travel positive. */
  lat: ArrayLike<number>;
}

/**
 * `ldOfPoint[k]` is the lap distance of road point k (ascending, one lap); `hl` and `hr` the half-widths there.
 */
export function roadUse(s: UseSamples, lapM: number, ldOfPoint: ArrayLike<number>, hl: ArrayLike<number>, hr: ArrayLike<number>): RoadUse | null {
  const n = ldOfPoint.length;
  if (n < 8 || !(lapM > 0) || s.ld.length === 0) return null;
  const counts = new Float32Array(n * USE_COLUMNS);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const total = new Float32Array(n);
  // the road point a lap distance falls on: the last point at or before it
  const pointOf = (d: number) => {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ldOfPoint[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  for (let i = 0; i < s.ld.length; i++) {
    const k = pointOf(s.ld[i]);
    const l = s.lat[i];
    const u = (l + hl[k]) / (hl[k] + hr[k]);
    total[k]++;
    if (l >= hr[k] - TOUCH_M) right[k]++;
    if (l <= -hl[k] + TOUCH_M) left[k]++;
    if (u >= 0 && u < 1) counts[k * USE_COLUMNS + Math.floor(u * USE_COLUMNS)]++;
  }
  // smooth along the road with a box over +-SMOOTH_M of lap distance (the points are about equally spaced)
  const per = lapM / n;
  const reach = Math.max(1, Math.round(SMOOTH_M / per));
  const shade = new Float32Array(n * USE_COLUMNS);
  const kerbLeft = new Uint8Array(n);
  const kerbRight = new Uint8Array(n);
  const window = new Float32Array(USE_COLUMNS);
  let wl = 0;
  let wr = 0;
  let wt = 0;
  const addPoint = (k: number, sign: number) => {
    const j = ((k % n) + n) % n;
    for (let c = 0; c < USE_COLUMNS; c++) window[c] += sign * counts[j * USE_COLUMNS + c];
    wl += sign * left[j];
    wr += sign * right[j];
    wt += sign * total[j];
  };
  for (let k = -reach; k <= reach; k++) addPoint(k, 1);
  for (let k = 0; k < n; k++) {
    let peak = 0;
    for (let c = 0; c < USE_COLUMNS; c++) peak = Math.max(peak, window[c]);
    if (peak > 0) for (let c = 0; c < USE_COLUMNS; c++) shade[k * USE_COLUMNS + c] = window[c] / peak;
    if (wt >= MIN_SAMPLES) {
      kerbLeft[k] = wl / wt >= KERB_SHARE ? 1 : 0;
      kerbRight[k] = wr / wt >= KERB_SHARE ? 1 : 0;
    }
    addPoint(k - reach, -1);
    addPoint(k + reach + 1, 1);
  }
  return {shade, kerbLeft, kerbRight};
}
