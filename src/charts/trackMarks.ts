import {type MapAnchor, type MapMarks} from './TrackMap';

// Track mode labels (handoff v2 M1a): a tick across the band at each
// section boundary, S1–S5 labels inside the loop, corner numbers outside.
// Each mark is an anchor on the reference line plus two neighbours, so the
// chart can find the band's normal in screen space and offset from there.

type Xy = {x: number; y: number};

/** The map's sections (data/sessions MapSection), as far as marks need them. */
type MarkCorner = {n: number; entryM: number; apexM: number};
type MarkSection = MarkCorner & {parts: MarkCorner[]};

// Boundaries at each section's entry; section labels halfway to the next
// boundary; corner numbers at each corner's apex.
export type TrackMarks = MapMarks;

// Neighbours ±10 m either side give a steady tangent on a 5 m grid.
const TANGENT_M = 10;

export function buildTrackMarks(
  sections: MarkSection[],
  lengthM: number,
  /** Map point on the reference line at a distance (wraps are clamped). */
  pointAt: (m: number) => Xy,
): TrackMarks {
  const anchor = (m: number): MapAnchor => ({
    at: pointAt(m),
    prev: pointAt(m - TANGENT_M),
    next: pointAt(m + TANGENT_M),
  });
  const sorted = [...sections].sort((a, b) => a.entryM - b.entryM);
  return {
    boundaries: sorted.map(s => anchor(s.entryM)),
    sections: sorted.map((s, i) => {
      // The last section runs to the first section's entry on the next lap.
      const end =
        i + 1 < sorted.length
          ? sorted[i + 1].entryM
          : lengthM + (sorted[0]?.entryM ?? 0);
      return {n: s.n, anchor: anchor(((s.entryM + end) / 2) % lengthM)};
    }),
    corners: sorted.flatMap(s =>
      (s.parts.length > 0 ? s.parts : [s]).map(c => ({
        n: c.n,
        anchor: anchor(c.apexM),
      })),
    ),
  };
}
