// Where a set of laps scatters: each section's share of the lap-to-lap spread
// (pit-wall thread 88, slipstream's idea 1). A section's spread is the robust
// variance (IQR / 1.349)^2, the one spread the app shows (setStats.ts iqr)
// squared, so one bad lap cannot make a section the culprit. Shares are of the
// sum of the sections' spreads, not of the lap's variance: sections are not
// independent (one's exit speed is the next one's entry), so the number says
// where the scatter is measured, never how much lap time it costs.
// Pure; no imports beyond setStats (the uploader runs it as is).
import {iqr, type Sample} from './setStats.ts';

/** Fewest laps a section needs before its spread counts: with fewer the IQR is noise (his median session has 5 clean laps; the measure held on sessions of 10+). */
export const MIN_SPREAD_LAPS = 10;
/** The IQR of a normal distribution is 1.349 sigma. */
const IQR_PER_SIGMA = 1.349;

export interface SpreadShare {
  /** The section's index among the columns given. */
  index: number;
  /** 0..1, over the sections with a spread. */
  share: number;
}

/**
 * Each section's share of the spread, biggest first; null when fewer than two
 * sections have MIN_SPREAD_LAPS times or every spread is 0. `columns[i]` are
 * the basis laps' times in section i (missing skipped).
 */
export function spreadShares(
  columns: readonly (readonly Sample[])[],
): SpreadShare[] | null {
  const spreads: {index: number; v: number}[] = [];
  columns.forEach((times, index) => {
    const n = times.filter(t => t != null && Number.isFinite(t)).length;
    const s = n >= MIN_SPREAD_LAPS ? iqr(times) : null;
    if (s != null) spreads.push({index, v: (s / IQR_PER_SIGMA) ** 2});
  });
  const total = spreads.reduce((t, s) => t + s.v, 0);
  if (spreads.length < 2 || !(total > 0)) return null;
  return spreads
    .map(s => ({index: s.index, share: s.v / total}))
    .sort((a, b) => b.share - a.share || a.index - b.index);
}
