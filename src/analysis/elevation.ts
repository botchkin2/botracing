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
