import {brakeSpread} from '@/src/analysis/brakeSpread';
import {
  type Lap,
  sectionWindowState,
  type TrackMapData,
} from '@/src/data/sessions';
import {isCompound} from '@/src/data/sessions/corners';
import {formatWhole, turnLabel} from '@/src/design';

/** Rows shown: the loosest few braking zones. */
export const BRAKE_ROWS = 4;

/** One braking zone: where each lap began to brake, against the zone's median. */
export type BrakeRow = {
  /** "T3": the corner the zone belongs to. */
  head: string;
  /** "14 m": p10 to p90 of the brake-on distance. */
  spread: string;
  /** Each lap's offset from the median over the widest offset shown, -1..1; null where the lap did not brake. */
  dots: (number | null)[];
  /** Where a tap opens Corner: the zone's own corner. */
  corner: number | null;
  /** Opens the section whole (a single-corner section); false picks the one part. */
  whole: boolean;
};

/**
 * The loosest braking zones of the basis laps. A zone is a corner part: a
 * single-corner section is one, a compound section is one per part, each from
 * the part's stored brake-on distance (`brakeAtM`, the application braking for
 * that part). The section's own `brakeAtM` is "wherever the lap first braked in
 * the window", so for a compound section it would mix two boards (chord on
 * #662). One scale for the rows shown, so a zone four times looser looks four
 * times wider. A window that does not count (pit, off track, cut at other
 * boundaries) gives no point; a zone needs analysis/spreadShare.ts
 * MIN_SPREAD_LAPS laps that braked. Pure.
 */
export function brakeLedger(
  laps: readonly Lap[],
  basis: ReadonlySet<string>,
  map: TrackMapData | null,
): BrakeRow[] {
  if (!map?.boundaries) return [];
  const boundaries = map.boundaries;
  const picked = laps.filter(l => basis.has(l.id));
  // One entry per zone, in track order: where it opens Corner, its name, and
  // the part of each lap's section facts it reads.
  const zones: {
    head: string;
    corner: number;
    whole: boolean;
    times: (number | null)[];
  }[] = [];
  map.sections.forEach((section, i) => {
    const counts = picked.map(l =>
      sectionWindowState(l, i, boundaries) === 'counts' ? l.sections[i] : null,
    );
    if (section.parts.length === 0) {
      zones.push({
        head: turnLabel(section.n, section.official),
        corner: section.n,
        whole: isCompound(section),
        times: counts.map(f => f?.brakeAtM ?? null),
      });
      return;
    }
    section.parts.forEach((part, j) =>
      zones.push({
        head: turnLabel(part.n, part.official),
        corner: part.n,
        whole: false,
        times: counts.map(f => f?.parts[j]?.brakeAtM ?? null),
      }),
    );
  });
  const ranked = brakeSpread(zones.map(z => z.times)).slice(0, BRAKE_ROWS);
  const widest = Math.max(
    0,
    ...ranked.flatMap(z => z.offsetsM.map(o => Math.abs(o ?? 0))),
  );
  return ranked.map(z => ({
    head: zones[z.index].head,
    spread: `${formatWhole(z.spreadM)} m`,
    dots: z.offsetsM.map(o => (o == null || widest === 0 ? null : o / widest)),
    corner: zones[z.index].corner,
    whole: zones[z.index].whole,
  }));
}
