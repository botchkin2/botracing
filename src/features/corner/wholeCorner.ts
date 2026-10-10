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
 * all of them are the corner's own. Over the whole compound window:
 *  - entry: one part for the whole set of laps (entryPartOf): the part most
 *    laps' first brake application brakes for. Brake point, peak brake and
 *    turn-in are that part's, measured to its apex, so a column never mixes
 *    apexes. The braking that starts the window is not always for its first
 *    corner (Road Atlanta T2-5 brakes for T3).
 *  - exit: the last part. Throttle pickup and lowest throttle are that part's,
 *    measured from its apex.
 *  - throttle: the last part's full-throttle point, from its apex, for every
 *    lap. A lap already at full throttle there reads "at min".
 *  - whole: the section's own facts. Time, slowest speed and apex speed are
 *    over the full window, and its edge flag gates the exit facts: the window
 *    had a slowest point of its own even when the last part had none.
 */
export type CornerSources = {
  entry: FactSource;
  exit: FactSource;
  throttle: FactSource;
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
  /** The set's entry part (entryPartOf); the first part when not given. */
  entryN: number | null = null,
): CornerSources {
  const own = {facts: lapCornerFacts(lap, corner), apexM: corner.apexM};
  const members = sectionMembers(all, corner);
  if (!whole || members.length < 2)
    return {entry: own, exit: own, throttle: own, whole: own};
  const first = members[0];
  const last = members[members.length - 1];
  const entryPart = members.find(m => m.n === entryN) ?? first;
  const win = {
    facts: lapCornerFacts(lap, {...first, partIndex: null}),
    apexM: sectionApexM,
  };
  const exit = {facts: lapCornerFacts(lap, last), apexM: last.apexM};
  return {
    entry: {facts: lapCornerFacts(lap, entryPart), apexM: entryPart.apexM},
    exit,
    throttle: exit,
    whole: win,
  };
}

/**
 * The entry part for a set of laps over a compound window: the part most laps'
 * first brake application brakes for (else the part holding their slowest
 * point). A tie goes to the earlier part. Null when no lap says.
 */
export function entryPartOf(
  laps: Lap[],
  all: TrackCorner[],
  corner: TrackCorner,
): number | null {
  const members = sectionMembers(all, corner);
  const votes = new Map<number, number>();
  for (const lap of laps) {
    const section = lap.sections[corner.sectionIndex];
    const n = section?.brakeApps[0]?.part ?? section?.window?.minSpeedPart;
    if (n != null && members.some(m => m.n === n))
      votes.set(n, (votes.get(n) ?? 0) + 1);
  }
  let best: number | null = null;
  for (const m of members)
    if ((votes.get(m.n) ?? 0) > (votes.get(best ?? -1) ?? 0)) best = m.n;
  return best;
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

/** "T2–5" for a compound section, "T7" for one; from "S2 (T2–T5)". */
export function wholeLabel(sectionLabel: string): string {
  const inner = /\((.*)\)/.exec(sectionLabel)?.[1] ?? sectionLabel;
  return inner.replace(/–T(?=\d)/g, '–');
}

/** "Turns 2–5" for a compound section, "Turn 7" for one; from "S2 (T2–T5)". */
export function wholeTitle(sectionLabel: string): string {
  const inner = /\((.*)\)/.exec(sectionLabel)?.[1] ?? sectionLabel;
  const many = /[–,-]/.test(inner);
  return `${many ? 'Turns' : 'Turn'} ${inner.replace(/T(?=\d)/g, '')}`;
}
