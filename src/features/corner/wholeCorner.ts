// "All" for a compound corner (roadmap D49): the Corner screen read over the
// whole window of a section, first entry to last exit, instead of one part.
// Pure. Which fact comes from which part is decided here once, so the table,
// the strips, the braking map and the trace markers cannot disagree.
import {
  type CornerFacts,
  type Lap,
  lapCornerFacts,
  type TrackCorner,
} from '@/src/data/sessions';

/** A set of facts and the apex their distances are measured from. */
export type FactSource = {facts: CornerFacts | null; apexM: number};

/**
 * Where each fact of a corner comes from. For a single corner (or one part)
 * all three are the corner's own. Over the whole compound window:
 *  - entry: the first part. Brake point, peak brake and turn-in belong to the
 *    braking and turn-in that start the window, measured to that part's apex.
 *  - exit: the last part. Throttle pickup, full throttle and lowest throttle
 *    belong to the exit that ends the window, measured from that part's apex.
 *  - whole: the section's own facts. Time, slowest speed and apex speed are
 *    over the full window (no single part's number would be the window's).
 */
export type CornerSources = {
  entry: FactSource;
  exit: FactSource;
  whole: FactSource;
};

/** The parts of the section the corner is in, in track order. */
export function sectionMembers(
  all: TrackCorner[],
  corner: TrackCorner,
): TrackCorner[] {
  return all.filter(c => c.sectionN === corner.sectionN);
}

export function cornerSources(
  lap: Lap,
  all: TrackCorner[],
  corner: TrackCorner,
  whole: boolean,
  sectionApexM: number,
): CornerSources {
  const own = {facts: lapCornerFacts(lap, corner), apexM: corner.apexM};
  const members = sectionMembers(all, corner);
  if (!whole || members.length < 2) return {entry: own, exit: own, whole: own};
  const first = members[0];
  const last = members[members.length - 1];
  return {
    entry: {facts: lapCornerFacts(lap, first), apexM: first.apexM},
    exit: {facts: lapCornerFacts(lap, last), apexM: last.apexM},
    whole: {
      facts: lapCornerFacts(lap, {...first, partIndex: null}),
      apexM: sectionApexM,
    },
  };
}

/**
 * The corner whose slice file holds the window: the last part's, whose extent
 * runs from the section's start to its end (tools/sessions/cornerSlices.mjs).
 * A single corner, or one part, is its own.
 */
export function sliceCornerOf(
  all: TrackCorner[],
  n: number,
  whole: boolean,
): number {
  const at = all.find(c => c.n === n);
  if (!whole || !at) return n;
  const members = sectionMembers(all, at);
  return members[members.length - 1].n;
}

/** "Turns 2–5" for a compound section, "Turn 7" for one; from "S2 (T2–T5)". */
export function wholeTitle(sectionLabel: string): string {
  const inner = /\((.*)\)/.exec(sectionLabel)?.[1] ?? sectionLabel;
  const many = /[–,-]/.test(inner);
  return `${many ? 'Turns' : 'Turn'} ${inner.replace(/T(?=\d)/g, '')}`;
}
