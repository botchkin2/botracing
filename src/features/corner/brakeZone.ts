import {BRAKE_RELEASED_PCT} from '@/src/analysis/cornerBoundaries';

/** One lap's brake point and its pedal trace on the zoom grid. */
export type BrakeZoneLine = {brakeAtM: number | null; brakePct: number[]};

/**
 * The braking zone for the brake trace: from the median brake point to the
 * median release, over the laps that braked for this corner. The release is
 * the first grid point after the brake point with the pedal below
 * BRAKE_RELEASED_PCT. Null when no lap in the set braked here.
 */
export function brakeZone(
  lines: BrakeZoneLine[],
  stepM: number,
): [number, number] | null {
  const spans = lines.flatMap(l => {
    if (l.brakeAtM == null) return [];
    let i = Math.round(l.brakeAtM / stepM);
    while (i < l.brakePct.length && l.brakePct[i] >= BRAKE_RELEASED_PCT) i++;
    return [{on: l.brakeAtM, off: i * stepM}];
  });
  if (spans.length === 0) return null;
  return [median(spans.map(s => s.on)), median(spans.map(s => s.off))];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
