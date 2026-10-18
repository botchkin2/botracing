// How tightly a set of laps brakes for each corner (pit-wall thread 88,
// ghost's brake-board ledger): per braking zone, where each lap's brake
// application began (metres of lap distance, the stored `brakeAtM`), their
// median and the p10 to p90 spread in metres, the language of the roadside
// boards. Laps that did not brake there are skipped, never counted as 0.
// Pure; no imports beyond setStats (the uploader runs it as is).
import {percentile, type Sample} from './setStats.ts';
import {MIN_SPREAD_LAPS} from './spreadShare.ts';

export interface BrakeZone {
  /** The zone's index among the columns given. */
  index: number;
  /** Laps that braked here. */
  n: number;
  medianM: number;
  /** p90 - p10 of the brake-on distance, metres. */
  spreadM: number;
  /** Each given lap's brake-on minus the median, metres; null where it did not brake. */
  offsetsM: (number | null)[];
}

/**
 * The zones with at least MIN_SPREAD_LAPS braking laps, loosest first.
 * `zones[i]` is the brake-on distance of each lap in zone i (one entry per
 * lap, null where the lap did not brake or the window does not count).
 */
export function brakeSpread(
  zones: readonly (readonly Sample[])[],
): BrakeZone[] {
  const out: BrakeZone[] = [];
  zones.forEach((times, index) => {
    const n = times.filter(t => t != null && Number.isFinite(t)).length;
    if (n < MIN_SPREAD_LAPS) return;
    const medianM = percentile(times, 0.5);
    const p10 = percentile(times, 0.1);
    const p90 = percentile(times, 0.9);
    if (medianM == null || p10 == null || p90 == null) return;
    out.push({
      index,
      n,
      medianM,
      spreadM: p90 - p10,
      offsetsM: times.map(t =>
        t != null && Number.isFinite(t) ? t - medianM : null,
      ),
    });
  });
  return out.sort((a, b) => b.spreadM - a.spreadM || a.index - b.index);
}
