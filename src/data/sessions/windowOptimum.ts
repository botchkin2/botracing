// Feeds src/analysis/sectionOptimum.ts from a session's laps and the layout's
// corner windows: which lap times count in which window. A window counts for a
// comparable lap cut at the current boundaries unless the pit lane crosses it,
// or the lap went off track in it. A yellow, local or full-course, is never
// an exclusion (Botkin, decisions/lap/2026-10-11-selection-and-numbers.md): a
// yellow says nothing about this driver's time. LMU's sector flag is a third
// of the lap, so any incident in that third used to empty race tables
// (thread 54, da3e67). Tow, traffic and blue flags never remove a
// time (decisions/lap/2026-10-01-corner-windows.md).
import {
  type OptimumLap,
  sectionOptimum,
  type StintOptimum,
  type WindowMedian,
  windowMedians,
} from '@/src/analysis/sectionOptimum';

import type {
  BoundaryWindow,
  Lap,
  MapBoundaries,
  TrackMapData,
} from './adapters';

// The same cut-off the consistency tags use (src/analysis/consistency.ts
// cleanOffSec). Off is ≥2 wheels on loose for this long (triage #49).
export const OPTIMUM_OFF_TRACK_S = 0.3;

export interface SessionOptimum {
  /** The windows the per-stint arrays follow, in lap order. */
  windows: BoundaryWindow[];
  stints: StintOptimum[];
}

interface WindowFacts {
  segTimeS: number | null;
  offTrackS: number;
  pit: boolean;
}

function countsAs(f: WindowFacts | null | undefined): number | null {
  if (!f || f.segTimeS == null) return null;
  if (f.pit || f.offTrackS >= OPTIMUM_OFF_TRACK_S) return null;
  return f.segTimeS;
}

export interface Frame {
  boundaries: MapBoundaries;
  sectionIndex: Map<number, number>;
}

export function frameOf(map: TrackMapData): Frame | null {
  const boundaries = map.boundaries;
  if (!boundaries) return null;
  return {
    boundaries,
    sectionIndex: new Map(map.sections.map((s, i) => [s.n, i])),
  };
}

/** Whether a lap's windows were cut at the boundaries the map carries now. */
export function isCurrent(lap: Lap, boundaries: MapBoundaries): boolean {
  const stamp = lap.cornerBoundaries;
  return (
    stamp != null && stamp.v === boundaries.v && stamp.rev === boundaries.rev
  );
}

/** False when the map has no windows, or the lap was cut at other ones: its window times are not comparable with the map's. */
export function onCurrentBoundaries(lap: Lap, map: TrackMapData): boolean {
  return map.boundaries != null && isCurrent(lap, map.boundaries);
}

/** A lap's time in every window, null where it does not count (see the top of this file). */
export function windowTimesOf(lap: Lap, frame: Frame): (number | null)[] {
  return frame.boundaries.windows.map(w => {
    if (w.kind === 'start-straight') return countsAs(lap.startStraight);
    const i = w.section == null ? undefined : frame.sectionIndex.get(w.section);
    const facts = i == null ? null : lap.sections[i];
    if (!facts?.window) return null;
    return countsAs({...facts, pit: facts.window.pit});
  });
}

/**
 * A lap's time in each map section, by section number, under the one rule
 * every table uses (windowTimesOf): null where the window does not count
 * (pit, off track, full-course yellow) or the lap was cut at other boundaries.
 * Null when the map has no windows; the caller then has only the lap's own
 * segment times. Compare's section table and Session's grid read the same
 * cell this way (radio #4399, one answer per question).
 */
export function sectionWindowTimes(
  lap: Lap,
  map: TrackMapData,
): Map<number, number | null> | null {
  const frame = frameOf(map);
  if (!frame) return null;
  const out = new Map<number, number | null>();
  const times = isCurrent(lap, frame.boundaries)
    ? windowTimesOf(lap, frame)
    : null;
  frame.boundaries.windows.forEach((w, i) => {
    if (w.kind === 'start-straight' || w.section == null) return;
    out.set(w.section, times ? times[i] : null);
  });
  return out;
}

/**
 * Per stint, the best and median of each window. By default over the
 * comparable laps; with `picked`, over exactly the laps given, comparable or
 * not, since the user chose them (the Corner card's ticked laps, decision
 * 2026-10-11): a pit or off-track window is left out by itself. Null
 * until the track has corner windows (before the resync).
 */
export function sessionOptimum(
  laps: Lap[],
  map: TrackMapData,
  {picked = false}: {picked?: boolean} = {},
): SessionOptimum | null {
  const frame = frameOf(map);
  if (!frame) return null;
  const input: OptimumLap[] = [];
  for (const lap of laps) {
    if (!(picked || lap.comparable) || !isCurrent(lap, frame.boundaries))
      continue;
    input.push({
      id: lap.id,
      stint: lap.stint,
      windowsS: windowTimesOf(lap, frame),
    });
  }
  return {
    windows: frame.boundaries.windows,
    stints: sectionOptimum(input, frame.boundaries.windows.length),
  };
}

/** What a table reads each lap against: a median per window and the laps behind it. */
export interface WindowReference {
  windows: BoundaryWindow[];
  /** One per window, in lap order; null where under the floor. */
  medians: WindowMedian[];
  /** Laps that were cut at the current boundaries and so counted. */
  laps: number;
}

/**
 * The median of each window over laps the user picked (Compare's checked
 * laps): any lap cut at the current boundaries, comparable or not, since the
 * user chose them and a pit or off-track window is left out by itself.
 */
export function checkedWindowMedians(
  laps: Lap[],
  map: TrackMapData,
  minLaps?: number,
): WindowReference | null {
  const frame = frameOf(map);
  if (!frame) return null;
  const input = laps
    .filter(l => isCurrent(l, frame.boundaries))
    .map(l => ({id: l.id, stint: l.stint, windowsS: windowTimesOf(l, frame)}));
  return {
    windows: frame.boundaries.windows,
    medians: windowMedians(input, frame.boundaries.windows.length, minLaps),
    laps: input.length,
  };
}

/** One stint's window medians from the session's laps (the stint's comparable laps, 5 or more). */
export function stintWindowMedians(
  laps: Lap[],
  map: TrackMapData,
  stint: number,
): (WindowReference & {stint: number}) | null {
  const optimum = sessionOptimum(laps, map);
  const s = optimum?.stints.find(x => x.stint === stint);
  if (!optimum || !s) return null;
  return {
    stint,
    windows: optimum.windows,
    medians: s.windows.map(w => ({n: w.n, medianS: w.medianS})),
    laps: s.lapCount,
  };
}
