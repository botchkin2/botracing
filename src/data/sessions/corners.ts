import {
  type CornerFacts,
  type Lap,
  type MapCorner,
  type TrackMapData,
} from './adapters';
import {sectionNameOf} from '@/src/analysis/turnNames';

// Single corners (T1..Tn) flattened out of the track's sections. The map
// and every lap doc group corners into sections (S1..Sn), each with its
// corners in `parts`; a section with no parts counts as one corner. Shared
// by Corner (per-corner facts) and the Session desktop (stint vs stint).

export type TrackCorner = MapCorner & {
  /** Section this corner belongs to, and where it sits in the lists. */
  sectionN: number;
  sectionIndex: number;
  partIndex: number | null;
  /** The section's name, its turns: "T2–5" (sectionNameOf). */
  sectionLabel: string;
};

export function trackCorners(map: TrackMapData): TrackCorner[] {
  return map.sections.flatMap((s, si) => {
    const parts = s.parts.length ? s.parts : null;
    const sectionLabel = sectionNameOf(s);
    return (parts ?? [s]).map((c, pi) => ({
      ...c,
      sectionN: s.n,
      sectionIndex: si,
      partIndex: parts ? pi : null,
      sectionLabel,
    }));
  });
}

/** One lap's facts for a corner; falls back to the section's facts. */
export function lapCornerFacts(
  lap: Lap,
  corner: TrackCorner,
): CornerFacts | null {
  const section = lap.sections[corner.sectionIndex];
  if (!section) return null;
  if (corner.partIndex == null) return section;
  return section.parts[corner.partIndex] ?? null;
}

/**
 * A section is compound when it has more than one corner: it opens on All
 * (its window read whole) and its Parts row lists the corners.
 */
export const isCompound = (section: {parts: readonly unknown[]}): boolean =>
  section.parts.length > 1;

/** The first corner of a section, for opening a section from Compare. */
export function firstCornerOf(
  corners: TrackCorner[],
  sectionN: number,
): number | null {
  return corners.find(c => c.sectionN === sectionN)?.n ?? null;
}

/**
 * A lap's segment time for every corner in track order (sections' parts),
 * without needing the track map. Same order as trackCorners().
 */
export function lapCornerTimes(lap: Lap): (number | null)[] {
  return lap.sections.flatMap(s =>
    s.parts.length ? s.parts.map(p => p.segTimeS) : [s.segTimeS],
  );
}
