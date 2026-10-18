import {brakeSpread} from '@/src/analysis/brakeSpread';
import {sectionNameOf} from '@/src/analysis/turnNames';
import {
  firstCornerOf,
  type Lap,
  sectionWindowState,
  type TrackMapData,
  trackCorners,
} from '@/src/data/sessions';
import {isCompound} from '@/src/data/sessions/corners';
import {formatWhole} from '@/src/design';

/** Rows shown: the loosest few braking zones. */
export const BRAKE_ROWS = 4;

/** One braking zone: where each lap began to brake, against the zone's median. */
export type BrakeRow = {
  /** "T2–5". */
  head: string;
  /** "14 m": p10 to p90 of the brake-on distance. */
  spread: string;
  /** Each lap's offset from the median over the widest offset shown, -1..1; null where the lap did not brake. */
  dots: (number | null)[];
  /** Where a tap opens Corner (the section's first corner). */
  corner: number | null;
  whole: boolean;
};

/**
 * The loosest braking zones of the basis laps, from each corner window's
 * stored brake-on distance (`brakeAtM`), on the shared scale of the rows shown
 * so a zone four times looser looks four times wider. A window that does not
 * count (pit, off track, cut at other boundaries) gives no point; a zone needs
 * analysis/spreadShare.ts MIN_SPREAD_LAPS laps that braked. Pure.
 */
export function brakeLedger(
  laps: readonly Lap[],
  basis: ReadonlySet<string>,
  map: TrackMapData | null,
): BrakeRow[] {
  if (!map?.boundaries) return [];
  const boundaries = map.boundaries;
  const picked = laps.filter(l => basis.has(l.id));
  const zones = brakeSpread(
    map.sections.map((_, i) =>
      picked.map(l =>
        sectionWindowState(l, i, boundaries) === 'counts'
          ? l.sections[i]?.brakeAtM ?? null
          : null,
      ),
    ),
  ).slice(0, BRAKE_ROWS);
  const widest = Math.max(
    0,
    ...zones.flatMap(z => z.offsetsM.map(o => Math.abs(o ?? 0))),
  );
  const corners = trackCorners(map);
  return zones.map(z => {
    const section = map.sections[z.index];
    return {
      head: sectionNameOf(section),
      spread: `${formatWhole(z.spreadM)} m`,
      dots: z.offsetsM.map(o =>
        o == null || widest === 0 ? null : o / widest,
      ),
      corner: firstCornerOf(corners, section.n),
      whole: isCompound(section),
    };
  });
}
