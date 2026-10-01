// Feeds src/analysis/sectionOptimum.ts from a session's laps and the layout's
// corner windows: which lap times count in which window. A window counts for a
// comparable lap cut at the current boundaries unless the pit lane crosses it
// or the lap went off track or under a local yellow in it. Tow, traffic and
// blue flags never remove a time (decisions/lap/2026-10-01-corner-windows.md).
import {
  type OptimumLap,
  type StintOptimum,
  sectionOptimum,
} from '@/src/analysis/sectionOptimum';

import type {BoundaryWindow, Lap, TrackMapData} from './adapters';

// The same cut-offs the consistency tags use (src/analysis/consistency.ts
// cleanOffSec and yellowSec): a touch of the white line is not an off.
export const OPTIMUM_OFF_TRACK_S = 0.2;
export const OPTIMUM_YELLOW_S = 0.5;

export interface SessionOptimum {
  /** The windows the per-stint arrays follow, in lap order. */
  windows: BoundaryWindow[];
  stints: StintOptimum[];
}

interface WindowFacts {
  segTimeS: number | null;
  offTrackS: number;
  localYellowS: number;
  pit: boolean;
}

function countsAs(f: WindowFacts | null | undefined): number | null {
  if (!f || f.segTimeS == null) return null;
  if (f.pit || f.offTrackS >= OPTIMUM_OFF_TRACK_S) return null;
  if (f.localYellowS >= OPTIMUM_YELLOW_S) return null;
  return f.segTimeS;
}

/** Null until the track has corner windows (before the resync). */
export function sessionOptimum(
  laps: Lap[],
  map: TrackMapData,
): SessionOptimum | null {
  const boundaries = map.boundaries;
  if (!boundaries) return null;
  const sectionIndex = new Map(map.sections.map((s, i) => [s.n, i]));
  const input: OptimumLap[] = [];
  for (const lap of laps) {
    const stamp = lap.cornerBoundaries;
    if (
      !lap.comparable ||
      !stamp ||
      stamp.v !== boundaries.v ||
      stamp.rev !== boundaries.rev
    )
      continue;
    input.push({
      id: lap.id,
      stint: lap.stint,
      windowsS: boundaries.windows.map(w => {
        if (w.kind === 'start-straight') return countsAs(lap.startStraight);
        const i = w.section == null ? undefined : sectionIndex.get(w.section);
        const facts = i == null ? null : lap.sections[i];
        if (!facts?.window) return null;
        return countsAs({...facts, pit: facts.window.pit});
      }),
    });
  }
  return {
    windows: boundaries.windows,
    stints: sectionOptimum(input, boundaries.windows.length),
  };
}
