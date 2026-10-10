// The lap strip's numbers: one bar per lap, its height the lap's time against
// the median of the basis laps (the ticked laps, or every comparable lap when
// none are ticked; src/state/lapSelection.ts). Pure, so the strip is tested
// without a screen.

import {basisLaps} from '@/src/state/lapSelection';

export type StripLap = {
  id: string;
  timeS: number | null;
  stint: number;
  comparable: boolean;
};

export type StripBar = {
  lapId: string;
  stint: number;
  ticked: boolean;
  comparable: boolean;
  /** Seconds against the basis median; null when the lap or the basis has no time. */
  deltaS: number | null;
};

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function stripBars(
  laps: readonly StripLap[],
  ticked: readonly string[],
): {bars: StripBar[]; basisS: number | null} {
  const comparable = laps
    .filter(l => l.comparable && l.timeS != null)
    .map(l => l.id);
  const basis = new Set(basisLaps(ticked, comparable));
  const basisS = median(
    laps.flatMap(l => (basis.has(l.id) && l.timeS != null ? [l.timeS] : [])),
  );
  const bars = laps.map(l => ({
    lapId: l.id,
    stint: l.stint,
    ticked: ticked.includes(l.id),
    comparable: l.comparable,
    deltaS: basisS != null && l.timeS != null ? l.timeS - basisS : null,
  }));
  return {bars, basisS};
}
