import {type NativeSamples} from '@/src/analysis/nativeSamples';

// The track edges for the racing-line chart, from the laps' own samples.
// `TrackEdge` is the edge on the car's side (positive right, negative left,
// like the lateral it goes with), so one lap shows one edge at a time and it
// jumps when the car crosses the game's centre path (camber, pit-wall thread
// 27 #950). Both edges appear only where the laps together visited both
// sides. Each side comes as runs of consecutive points, so no line is drawn
// across a stretch where nobody was on that side.

export type EdgeRun = NativeSamples;

const BUCKET_M = 5;

/**
 * Per side, the median edge distance in each `BUCKET_M` bucket of [fromM, toM]
 * that any lap sampled on that side, split into runs of adjacent buckets.
 */
export function edgeRuns(
  laps: NativeSamples[],
  fromM: number,
  toM: number,
): {right: EdgeRun[]; left: EdgeRun[]} {
  const buckets = new Map<number, {right: number[]; left: number[]}>();
  for (const s of laps)
    for (let i = 0; i < s.distanceM.length; i++) {
      const m = s.distanceM[i];
      const v = s.values[i];
      if (m < fromM || m > toM || !Number.isFinite(v) || v === 0) continue;
      const k = Math.floor(m / BUCKET_M);
      const b = buckets.get(k) ?? {right: [], left: []};
      (v > 0 ? b.right : b.left).push(v);
      buckets.set(k, b);
    }
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  return {
    right: runs(keys, buckets, 'right'),
    left: runs(keys, buckets, 'left'),
  };
}

function runs(
  keys: number[],
  buckets: Map<number, {right: number[]; left: number[]}>,
  side: 'right' | 'left',
): EdgeRun[] {
  const out: EdgeRun[] = [];
  let run: EdgeRun | null = null;
  let last = -Infinity;
  for (const k of keys) {
    const values = buckets.get(k)![side];
    if (values.length === 0) continue;
    if (!run || k !== last + 1) {
      run = {distanceM: [], values: []};
      out.push(run);
    }
    run.distanceM.push(k * BUCKET_M + BUCKET_M / 2);
    run.values.push(median(values));
    last = k;
  }
  return out;
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
