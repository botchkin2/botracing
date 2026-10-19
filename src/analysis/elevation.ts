// The curated height along the lap (tools/curate plan-elevation) read at other
// spacings. The profile is in the corner map's distance frame, heightM[i] at
// i * stepM metres, so a chart on that frame draws it where the corners are.
// Pure.

export type Elevation = {stepM: number; heightM: readonly number[]};

/** The height at a distance, interpolated; clamped to the profile's ends. */
export function heightAt(e: Elevation, m: number): number {
  const at = Math.min(Math.max(m / e.stepM, 0), e.heightM.length - 1);
  const i = Math.floor(at);
  const next = Math.min(i + 1, e.heightM.length - 1);
  return e.heightM[i] + (e.heightM[next] - e.heightM[i]) * (at - i);
}

/**
 * The profile on a grid of `stepM` metres from the line, one value per grid
 * point to `lengthM`: what the Corner charts' series are (resample.ts grids).
 */
export function heightsOnGrid(
  e: Elevation,
  stepM: number,
  lengthM: number,
): number[] {
  const n = Math.floor(lengthM / stepM) + 1;
  return Array.from({length: n}, (_, i) => heightAt(e, i * stepM));
}

/** The lowest and highest height over a stretch of the lap (metres of lap distance), both ends included. */
export function heightRange(
  e: Elevation,
  fromM: number,
  toM: number,
): {lo: number; hi: number} {
  let lo = heightAt(e, fromM);
  let hi = lo;
  const end = heightAt(e, toM);
  lo = Math.min(lo, end);
  hi = Math.max(hi, end);
  const first = Math.max(0, Math.ceil(fromM / e.stepM));
  const last = Math.min(e.heightM.length - 1, Math.floor(toM / e.stepM));
  for (let i = first; i <= last; i++) {
    lo = Math.min(lo, e.heightM[i]);
    hi = Math.max(hi, e.heightM[i]);
  }
  return {lo, hi};
}

/**
 * The height at `m` metres on a lap of `lapM` metres, for a reader that goes round and round (the 3D chase): `m` wraps
 * into the lap, and past the last point the height runs back to the first over what is left of the lap.
 */
export function heightOnLap(e: Elevation, m: number, lapM: number): number {
  const at = ((m % lapM) + lapM) % lapM;
  const last = e.heightM.length - 1;
  const lastM = last * e.stepM;
  if (at <= lastM) return heightAt(e, at);
  const tail = lapM - lastM;
  const t = tail > 0 ? Math.min(1, (at - lastM) / tail) : 0;
  return e.heightM[last] + (e.heightM[0] - e.heightM[last]) * t;
}
