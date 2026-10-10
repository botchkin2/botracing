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
 *  - entry: the part the lap's first brake application brakes for (the
 *    section's `brakeApps[0].part`; else the part holding the slowest point;
 *    else the first). Brake point, peak brake and turn-in are that part's,
 *    measured to its apex: the braking that starts the window is not always
 *    for its first corner (Road Atlanta T2-5 brakes for T3).
 *  - exit: the last part. Throttle pickup and lowest throttle are that part's,
 *    measured from its apex.
 *  - throttle: the last part's full-throttle point, unless it was already at
 *    full throttle at that part's own slowest sample (a last part taken while
 *    accelerating); then the section's held point after the window's slowest
 *    sample, from the section's apex.
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
): CornerSources {
  const own = {facts: lapCornerFacts(lap, corner), apexM: corner.apexM};
  const members = sectionMembers(all, corner);
  if (!whole || members.length < 2)
    return {entry: own, exit: own, throttle: own, whole: own};
  const first = members[0];
  const last = members[members.length - 1];
  const section = lap.sections[first.sectionIndex];
  const braked = section?.brakeApps[0]?.part ?? section?.window?.minSpeedPart;
  const entryPart = members.find(m => m.n === braked) ?? first;
  const win = {
    facts: lapCornerFacts(lap, {...first, partIndex: null}),
    apexM: sectionApexM,
  };
  const exit = {facts: lapCornerFacts(lap, last), apexM: last.apexM};
  return {
    entry: {facts: lapCornerFacts(lap, entryPart), apexM: entryPart.apexM},
    exit,
    throttle: exit.facts?.fullThrottleAtEdge ? win : exit,
    whole: win,
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
