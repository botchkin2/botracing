// A channel's real samples: the rows where it was recorded, at their own
// distances. Charts draw these, not the grid, and readouts take the nearest
// one, so no drawn point or reported number is an in-between value
// (Botkin, pit-wall thread 26 #392/#397). The grid stays for cross-lap
// maths: time diff and the band.
//
// Distances come from integrated speed (lap distance is logged at 10 Hz),
// so a sample's position is an estimate; its value is not.
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

export interface NativeSamples {
  /** Ascending. */
  distanceM: number[];
  values: number[];
}

/** First index with distanceM >= m (binary search). */
function lowerBound(a: number[], m: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < m) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Samples inside [fromM, toM], plus one either side so a line runs to the
 * edges. Index-based, so a playback frame never scans the whole lap.
 */
export function sliceSamples(
  s: NativeSamples,
  fromM: number,
  toM: number,
): NativeSamples {
  const a = Math.max(0, lowerBound(s.distanceM, fromM) - 1);
  const b = Math.min(s.distanceM.length, lowerBound(s.distanceM, toM) + 1);
  return {distanceM: s.distanceM.slice(a, b), values: s.values.slice(a, b)};
}

/** The value of the real sample nearest to m; null with no samples. */
export function nearestSample(s: NativeSamples, m: number): number | null {
  const n = s.distanceM.length;
  if (n === 0) return null;
  const i = lowerBound(s.distanceM, m);
  if (i === 0) return s.values[0];
  if (i === n) return s.values[n - 1];
  return m - s.distanceM[i - 1] <= s.distanceM[i] - m
    ? s.values[i - 1]
    : s.values[i];
}

/**
 * At whole-lap zoom there are more samples than points: keep, per bucket of
 * bucketM metres, the first, the lowest and the highest sample (in order),
 * so peaks and dips survive. Every kept point is a real sample.
 */
export function thinSamples(s: NativeSamples, bucketM: number): NativeSamples {
  const n = s.distanceM.length;
  if (n === 0 || bucketM <= 0) return s;
  const keep: number[] = [];
  let i = 0;
  while (i < n) {
    const start = Math.floor(s.distanceM[i] / bucketM);
    let lo = i;
    let hi = i;
    let j = i;
    while (j < n && Math.floor(s.distanceM[j] / bucketM) === start) {
      if (s.values[j] < s.values[lo]) lo = j;
      if (s.values[j] > s.values[hi]) hi = j;
      j++;
    }
    for (const k of [...new Set([i, lo, hi])].sort((x, y) => x - y))
      keep.push(k);
    i = j;
  }
  return {
    distanceM: keep.map(k => s.distanceM[k]),
    values: keep.map(k => s.values[k]),
  };
}
