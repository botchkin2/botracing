import {type SegmentTimes} from '@/src/analysis/segments';
import {spreadShares} from '@/src/analysis/spreadShare';
import {formatWhole} from '@/src/design';

import type {SectionTable} from './model';

/** Rows shown: the biggest few; the rest are smaller (the shares add to 100). */
export const SPREAD_ROWS = 4;

/** One section's share of the set's lap-to-lap spread (analysis/spreadShare.ts). */
export type SpreadRow = {
  head: string;
  /** "41 %". */
  pct: string;
  /** The bar: this share over the biggest one, 0..1. */
  frac: number;
  /** Where a tap opens Corner (the section's first corner); null for the start straight. */
  corner: number | null;
  whole: boolean;
};

/**
 * The biggest sections by share of the basis laps' spread, biggest first;
 * none under analysis/spreadShare.ts MIN_SPREAD_LAPS laps. Pure: the Session
 * screen draws these and the Corner tab lands on the first.
 */
export function spreadRows(
  times: SegmentTimes | null,
  basis: ReadonlySet<string>,
  table: SectionTable | null,
): SpreadRow[] {
  if (!times) return [];
  const picked = times.laps.filter(l => basis.has(l.id));
  const shares = spreadShares(
    times.segments.map((_, i) => picked.map(l => l.timesS[i] ?? null)),
  );
  if (!shares) return [];
  const top = shares[0].share;
  return shares.slice(0, SPREAD_ROWS).map(s => ({
    head: times.segments[s.index].label,
    pct: `${formatWhole(s.share * 100)} %`,
    frac: s.share / top,
    corner: table?.targets[s.index]?.corner ?? null,
    whole: table?.targets[s.index]?.whole ?? false,
  }));
}
