// Corner windows that tile the lap (pit-wall thread 45, setup #1587 and #1589,
// decided #1590): an ordered list of boundaries from the start/finish line to
// the line, each section's window running from one boundary to the next, so the
// windows add up to the lap time and nothing wraps or borrows from the next lap.
//
// A boundary sits on the straight before a section, a margin before the
// EARLIEST brake or lift onset seen at the layout (any lap, session or car),
// where every lap is still doing the same speed. On a flat-out straight the
// exact metre costs every lap the same time, so the line falls where laps agree
// instead of mid-brake where they already differ. The map's own entry (the
// median onset) is not used: about half the laps brake before a median, and a
// map built from one car puts it wrong for another.
//
// The line is always a boundary. The last section's window ends at it and the
// stretch from the line to the first section's start is its own unit, the start
// straight. Nothing here knows a track; E8's custom sectors are this same list
// with boundaries the driver places.
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

/**
 * The version of these rules: bump it when they change what a boundary means
 * or where one falls, so a stored window and its times are never mixed with
 * another rule's (the uploader keeps it in `blockVersions.cornerBoundaries`).
 * 1: the earliest onset minus 0.5 s at that speed, clamped to the previous
 * section's exit, the line a boundary, parts tile their section's window.
 */
export const CORNER_BOUNDARIES_VERSION = 1;

/** How far before the earliest onset a boundary sits, in seconds at the speed there. */
export const BOUNDARY_MARGIN_S = 0.5;

// The brake and throttle levels the rest of the analysis uses for "working":
// the map's entry (corners.ts) and the pedal points (tools/sessions/
// pedalPoints.mjs), in percent.
export const BRAKE_ON_PCT = 10;
export const BRAKE_RELEASED_PCT = 2;
export const LIFT_BELOW_PCT = 90;
export const FULL_THROTTLE_PCT = 95;

/** How far before turn-in an onset is looked for (corners.ts `lookBackM`). */
const LOOK_BACK_M = 250;

/** A section of the track map, as `findTrackSections` gives it. */
export interface MapSection {
  n: number;
  entryM: number;
  turnInM: number;
  exitM: number;
  parts?: MapSection[];
}

/** One lap's pedals against its distance, all the same length and in lap order. */
export interface PedalTrace {
  distM: number[];
  brakePct: number[];
  throttlePct: number[];
}

export interface PartWindow {
  /** The part's number along the lap (the map's corner number). */
  n: number;
  fromM: number;
  toM: number;
}

export interface CornerWindow {
  kind: 'section' | 'start-straight';
  /** The section's number; null for the start straight. */
  section: number | null;
  fromM: number;
  toM: number;
  /** The parts of a compound section, tiling the window; empty for one corner. */
  parts: PartWindow[];
}

/**
 * Where a lap began braking or lifting for a section: the earliest sample of
 * the working run (brake at or past BRAKE_ON_PCT, or throttle under
 * LIFT_BELOW_PCT) that reaches the section's first corner, looking back from
 * its exit no further than LOOK_BACK_M before turn-in nor behind
 * `prevExitM`. Null when the lap took the corner flat (nothing working
 * before turn-in). Distances are the lap's own, so a brake that began before
 * the line is not this lap's.
 */
export function onsetM(
  lap: PedalTrace,
  section: MapSection,
  prevExitM: number,
): number | null {
  const first = section.parts?.[0] ?? section;
  const from = Math.max(prevExitM, first.turnInM - LOOK_BACK_M);
  let entry = -1;
  for (let i = lap.distM.length - 1; i >= 0; i--) {
    const d = lap.distM[i];
    if (d > first.exitM) continue;
    if (d < from) break;
    const working =
      lap.brakePct[i] >= BRAKE_ON_PCT || lap.throttlePct[i] < LIFT_BELOW_PCT;
    if (working) entry = i;
    else if (entry >= 0 && d < first.turnInM) break;
  }
  return entry < 0 ? null : lap.distM[entry];
}

/**
 * The windows that tile the lap, from the line to the line. `onsetsM` holds,
 * per section in map order, the onsets seen at the layout (`onsetM` over every
 * lap; empty or null entries are laps that took it flat). `speedKmhAt` is the
 * median speed at a lap distance, to turn the margin from seconds into metres.
 * Boundaries never fall behind the previous section's exit. A start straight
 * is returned only when the first boundary is past the line.
 */
export function cornerBoundaries(input: {
  lengthM: number;
  sections: MapSection[];
  onsetsM: (number | null)[][];
  speedKmhAt: (m: number) => number;
  marginS?: number;
}): CornerWindow[] {
  const {lengthM, sections, onsetsM, speedKmhAt} = input;
  const marginS = input.marginS ?? BOUNDARY_MARGIN_S;
  const starts: number[] = [];
  sections.forEach((s, k) => {
    const seen = (onsetsM[k] ?? []).filter(
      (m): m is number => m != null && Number.isFinite(m),
    );
    // The map's entry is the median onset, so it never falls before the
    // earliest one; it only stands in for a corner nobody braked for.
    const earliest = Math.min(s.entryM, ...seen);
    const marginM = (speedKmhAt(earliest) / 3.6) * marginS;
    const floor = k > 0 ? sections[k - 1].exitM : 0;
    const start = Math.max(floor, earliest - marginM, starts[k - 1] ?? 0);
    starts.push(Math.min(start, s.turnInM));
  });
  const windows: CornerWindow[] = [];
  if (starts.length === 0) return windows;
  if (starts[0] > 0) {
    windows.push({
      kind: 'start-straight',
      section: null,
      fromM: 0,
      toM: starts[0],
      parts: [],
    });
  }
  sections.forEach((s, k) => {
    // The first section reaches back to the line when no boundary is past it.
    const fromM = k === 0 && starts[0] <= 0 ? 0 : starts[k];
    const toM = k + 1 < sections.length ? starts[k + 1] : lengthM;
    windows.push({
      kind: 'section',
      section: s.n,
      fromM,
      toM,
      parts: partWindows(s, fromM, toM),
    });
  });
  return windows;
}

// A compound section's parts tile its window: each part starts at the map's
// entry for it (the brake or the steering reversal) and the last ends where the
// window does. A single corner has no parts of its own to list.
function partWindows(s: MapSection, fromM: number, toM: number): PartWindow[] {
  const parts = s.parts ?? [];
  if (parts.length < 2) return [];
  return parts.map((p, i) => ({
    n: p.n,
    fromM: i === 0 ? fromM : Math.min(Math.max(p.entryM, fromM), toM),
    toM:
      i + 1 < parts.length
        ? Math.min(Math.max(parts[i + 1].entryM, fromM), toM)
        : toM,
  }));
}

/** The time a window takes in one lap, split where the pedals say. */
export interface WindowSplit {
  /** From the boundary to the brake point: the straight before the corner. */
  runInS: number;
  /** From the brake point to full throttle. */
  cornerS: number;
  /** From full throttle to the next boundary. */
  exitS: number;
}

/**
 * One lap's window time split into run-in, corner and exit, the three adding up
 * to the window's time. `brakeAtM` and `fullThrottleAtM` are the lap's own pedal
 * points inside the window (null: no brake, or never full throttle); they are
 * clamped into the window and kept in order. With no brake the corner starts at
 * the window; with no full throttle it runs to the window's end.
 */
export function splitWindow(
  timeAt: (m: number) => number,
  window: {fromM: number; toM: number},
  points: {brakeAtM: number | null; fullThrottleAtM: number | null},
): WindowSplit {
  const {fromM, toM} = window;
  const clamp = (m: number) => Math.min(toM, Math.max(fromM, m));
  const brake = clamp(points.brakeAtM ?? fromM);
  const full = Math.max(brake, clamp(points.fullThrottleAtM ?? toM));
  const t0 = timeAt(fromM);
  return {
    runInS: timeAt(brake) - t0,
    cornerS: timeAt(full) - timeAt(brake),
    exitS: timeAt(toM) - timeAt(full),
  };
}

/** One brake application inside a section's window. */
export interface BrakeApplication {
  onsetM: number;
  /** The highest brake pressure of the application, percent. */
  peakPct: number;
  /** The number of the part the onset falls in; null for a single corner. */
  part: number | null;
}

/**
 * The brake applications of one lap inside a section's window: each runs from
 * the first sample at or past BRAKE_ON_PCT until the pedal is released below
 * BRAKE_RELEASED_PCT (trail braking hovering near 10 % does not split it, the
 * rule `pedalPoints.mjs` uses). The part is the one whose window holds the
 * onset. The bus stop is two of these across three parts.
 */
export function brakeApplications(
  lap: PedalTrace,
  window: CornerWindow,
): BrakeApplication[] {
  const out: BrakeApplication[] = [];
  let on = false;
  let current: BrakeApplication | null = null;
  for (let i = 0; i < lap.distM.length; i++) {
    const d = lap.distM[i];
    if (d < window.fromM || d >= window.toM) {
      if (d >= window.toM) break;
      continue;
    }
    const v = lap.brakePct[i];
    if (!on && v >= BRAKE_ON_PCT) {
      on = true;
      const part = window.parts.find(p => d >= p.fromM && d < p.toM);
      current = {onsetM: d, peakPct: v, part: part ? part.n : null};
      out.push(current);
    } else if (on && v < BRAKE_RELEASED_PCT) {
      on = false;
      current = null;
    } else if (on && current && v > current.peakPct) {
      current.peakPct = v;
    }
  }
  return out;
}
