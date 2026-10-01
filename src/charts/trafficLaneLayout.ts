// Pixel geometry of the Compare traffic lane: pure, so it is tested without
// react-native-svg. x comes from the caller's mapping (the same one the traces
// above use, metres or the reference's time), so spans line up with them.
import {type LaneRow} from '@/src/analysis/trafficLane';

/** A span narrower than this still shows (a 0.2 s run in a long window). */
export const MIN_SPAN_PT = 2;

export interface LaneGeometry {
  spans: {x: number; w: number}[];
  ticks: {x: number; label: 'BLUE' | 'PASS'}[];
}

export function laneGeometry(
  row: LaneRow,
  xOfM: (m: number) => number,
  width: number,
): LaneGeometry {
  const spans = row.ahead.flatMap(([a, b]) => {
    const x0 = Math.max(0, xOfM(a));
    const x1 = Math.min(width, xOfM(b));
    if (x1 < 0 || x0 > width) return [];
    return [{x: x0, w: Math.max(MIN_SPAN_PT, x1 - x0)}];
  });
  const ticks = row.ticks.flatMap(t => {
    const x = xOfM(t.m);
    return x < 0 || x > width
      ? []
      : [{x, label: t.kind === 'blue' ? ('BLUE' as const) : ('PASS' as const)}];
  });
  return {spans, ticks};
}
