import {BRAKE_RELEASED_PCT} from '@/src/analysis/cornerBoundaries';

/** A brake pedal run shorter than this does not end the application. */
const QUIET_M = 10;

/** One lap's brake point and its pedal trace on its own grid. */
export type BrakeZoneLine = {
  brakeAtM: number | null;
  brakePct: number[];
  stepM: number;
};

/**
 * The braking zone for the brake trace: from the median brake point to the
 * median release, over the laps that braked for this corner.
 *
 * A lap's zone starts at its brake point and ends where the application that
 * holds the corner's peak releases: the first point after it where the pedal
 * stays under BRAKE_RELEASED_PCT for QUIET_M metres. A dip shorter than that
 * (a feather, a dab then the main stop) does not end it, and a dab followed by
 * a longer stop runs to the stop's release. A lap whose application is still
 * open at `toM` (the end of the window) or the end of its trace (braking
 * across the start/finish line) gives no zone. Null when no lap gives one.
 */
export function brakeZone(
  lines: BrakeZoneLine[],
  toM: number,
): [number, number] | null {
  const spans = lines.flatMap(l => {
    const span = zoneOf(l, toM);
    return span ? [span] : [];
  });
  if (spans.length === 0) return null;
  return [median(spans.map(s => s[0])), median(spans.map(s => s[1]))];
}

function zoneOf(line: BrakeZoneLine, toM: number): [number, number] | null {
  if (line.brakeAtM == null) return null;
  const {brakePct, stepM} = line;
  const quiet = Math.ceil(QUIET_M / stepM);
  const end = Math.min(brakePct.length, Math.floor(toM / stepM) + 1);
  let peakPct = -1;
  let peakRelease: number | null = null;
  let i = Math.round(line.brakeAtM / stepM);
  while (i < end) {
    // One application: runs until `quiet` samples in a row are under the line.
    let last = -1;
    let appPeak = -1;
    let run = 0;
    let j = i;
    for (; j < end; j++) {
      const v = brakePct[j];
      if (v >= BRAKE_RELEASED_PCT) {
        last = j;
        run = 0;
        if (v > appPeak) appPeak = v;
      } else if (++run >= quiet) break;
    }
    if (last >= 0 && appPeak > peakPct) {
      // Still open at the window's end (or the trace's): no release to read.
      const closed = run >= quiet;
      peakPct = appPeak;
      peakRelease = closed ? (last + 1) * stepM : null;
    }
    i = j + 1;
  }
  if (peakRelease == null) return null;
  return [line.brakeAtM, peakRelease];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
