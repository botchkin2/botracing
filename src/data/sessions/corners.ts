import {
  type CornerFacts,
  type Lap,
  type MapCorner,
  type TrackMapData,
} from './adapters';

// Single corners (T1..Tn) flattened out of the track's sections. The map
// and every lap doc group corners into sections (S1..Sn), each with its
// corners in `parts`; a section with no parts counts as one corner. Shared
// by Corner (per-corner facts) and the Session desktop (stint vs stint).

export type TrackCorner = MapCorner & {
  /** Section this corner belongs to, and where it sits in the lists. */
  sectionN: number;
  sectionIndex: number;
  partIndex: number | null;
  /** Section label with its corner range, e.g. "S2 (T2–T5)". */
  sectionLabel: string;
};

export function trackCorners(map: TrackMapData): TrackCorner[] {
  return map.sections.flatMap((s, si) => {
    const parts = s.parts.length ? s.parts : null;
    const cs = parts ?? [s];
    // Same rule as design/format turnLabel; data does not import design.
    const name = (c: MapCorner) => c.official ?? `T${c.n}`;
    const first = name(cs[0]);
    const last = name(cs[cs.length - 1]);
    const range = cs.length > 1 ? `${first}–${last}` : first;
    const sectionLabel = `S${s.n} (${range})`;
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
