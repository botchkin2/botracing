// The lap strip's numbers: one bar per lap, its height the lap's time against
// the median of the basis laps (the ticked laps, or every comparable lap when
// none are ticked; src/state/lapSelection.ts). Pure, so the strip is tested
// without a screen.

import {columnStats} from '@/src/analysis/segments';

import {basisOf} from './selectionStats';

export type StripLap = {
  id: string;
  timeS: number | null;
  stint: number;
  comparable: boolean;
  /** Entered or left the pit lane. */
  pit: boolean;
};

export type StripBar = {
  lapId: string;
  stint: number;
  ticked: boolean;
  comparable: boolean;
  pit: boolean;
  /** Seconds against the basis median; null when the lap or the basis has no time. */
  deltaS: number | null;
};

export function stripBars(
  laps: readonly StripLap[],
  ticked: readonly string[],
): {bars: StripBar[]; basisS: number | null} {
  // The same basis as every other comparison (selectionStats): the ticked laps
  // of this session, else every comparable lap.
  const basis = basisOf(laps, new Set(ticked));
  const basisS = columnStats(basis.map(l => l.timeS)).medianS;
  const bars = laps.map(l => ({
    lapId: l.id,
    stint: l.stint,
    ticked: ticked.includes(l.id),
    comparable: l.comparable,
    pit: l.pit,
    deltaS: basisS != null && l.timeS != null ? l.timeS - basisS : null,
  }));
  return {bars, basisS};
}

/** The laps of each stint, as index ranges over the strip (inclusive ends). */
export function stintSpans(
  laps: readonly StripLap[],
): {stint: number; from: number; to: number}[] {
  const spans: {stint: number; from: number; to: number}[] = [];
  laps.forEach((l, i) => {
    const last = spans[spans.length - 1];
    if (last && last.stint === l.stint) last.to = i;
    else spans.push({stint: l.stint, from: i, to: i});
  });
  return spans;
}
