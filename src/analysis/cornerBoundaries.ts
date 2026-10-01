// Corner windows that tile the lap (pit-wall thread 45, setup #1587 and #1589,
// decided #1590, hardened #1608): an ordered list of boundaries from the
// start/finish line to the line, each section's window running from one
// boundary to the next, so the windows add up to the lap time and nothing wraps
// or borrows from the next lap.
//
// A boundary sits on the straight before a section, a margin before where the
// earliest laps at the layout start braking (or, for a section nobody brakes
// for, lifting), where every lap is still doing the same speed. On a flat-out
// straight the exact metre costs every lap the same time, so the line falls
// where laps agree instead of mid-brake where they already differ. The map's
// own entry (the median onset) is not used for it: about half the laps brake
// before a median, and a map built from one car puts it wrong for another.
//
// "Earliest" is a low percentile of the pooled laps, not a minimum, so one lap
// that coasts, spins or runs wide cannot drag a boundary hundreds of metres
// early. The pool keeps a histogram per session, so a resync replaces a
// session's own laps instead of counting them twice, and until it holds
// enough laps from enough sessions the boundary is provisional (the map's
// entry), so no single session sets one.
//
// The line is always a boundary. The last section's window ends at it and the
// stretch from the line to the first section's start is its own unit, the start
// straight. Nothing here knows a track; E8's custom sectors are this same list
// with boundaries the driver places.
//
// Every distance here is in the map's frame, the lap's fraction times the track
// map's length (as the slices already are), never a recording's raw lap
// distance: recordings differ by metres in length and alignment, so onsets
// pooled across sessions in raw distance would smear.
//
// Plain TypeScript with erasable syntax only, no imports: Node runs it as is.

/**
 * The version of these rules: bump it when they change what a boundary means
 * or where one falls, so a stored window and its times are never mixed with
 * another rule's (the uploader keeps it in `blockVersions.cornerBoundaries`).
 * 1: the 5th percentile of pooled onsets minus 0.5 s at that speed, clamped to
 * the previous section's exit, the line a boundary, parts tile their section.
 */
export const CORNER_BOUNDARIES_VERSION = 1;

/** How far before the earliest onset a boundary sits, in seconds at the speed there. */
export const BOUNDARY_MARGIN_S = 0.5;
/** The share of pooled laps that begin before the boundary's reference onset. */
export const EARLIEST_QUANTILE = 0.05;
/** Laps and sessions the pool needs before its percentile replaces the map's entry. */
export const MIN_POOL_LAPS = 20;
export const MIN_POOL_SESSIONS = 2;
/** Onsets are pooled in bins this wide, metres. */
export const ONSET_BIN_M = 5;

// The brake and throttle levels the rest of the analysis uses: the map's entry
// (corners.ts) and the pedal points (tools/sessions/pedalPoints.mjs), percent.
export const BRAKE_ON_PCT = 10;
export const BRAKE_RELEASED_PCT = 2;
export const LIFT_BELOW_PCT = 90;
/**
 * The corner/exit split is the first full-throttle point that holds: 95 %
 * for 0.3 s, so a flick mid-chicane does not end the corner; failing that, a
 * traction-limited exit that never sits at 95 % counts from 85 % held for
 * 0.5 s.
 */
export const FULL_THROTTLE_PCT = 95;
export const FULL_THROTTLE_HOLD_S = 0.3;
export const PARTIAL_THROTTLE_PCT = 85;
export const PARTIAL_THROTTLE_HOLD_S = 0.5;

/**
 * How far before turn-in an onset is looked for: LOOK_BACK_S of driving at the
 * speed there, and never more than MAX_LOOK_BACK_M (which also sizes the onset
 * pools). Without a speed trace, LOOK_BACK_M (corners.ts `lookBackM`). A GT3
 * into Daytona T1 or a Le Mans chicane from 300+ km/h brakes 230 to 280 m out.
 */
export const LOOK_BACK_S = 5;
export const MAX_LOOK_BACK_M = 400;
const LOOK_BACK_M = 250;
/** A section counts as braked when at least this share of laps brake for it. */
const BRAKED_SHARE = 0.5;
const DEFAULT_SPEED_KMH = 180;

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
  /** Seconds from the lap start per sample; needed only by `fullThrottlePointM`. */
  timeS?: number[];
  /** Speed per sample, km/h; sizes the look-back of an onset. */
  speedKmh?: number[];
}

export interface PartWindow {
  /** The part's number along the lap (the map's corner number). */
  n: number;
  /** Where the part turns in: a brake application belongs to the first part that turns in after its onset. */
  turnInM: number;
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

export type OnsetKind = 'brake' | 'lift';

// Where the working run that reaches a section's first corner begins: walking
// back from that corner's exit, the earliest sample of an unbroken run of
// `working`. The look-back is LOOK_BACK_S at the speed at turn-in (at most
// MAX_LOOK_BACK_M), and the previous section's exit is a floor. A brake run
// holds on until the pedal is released below BRAKE_RELEASED_PCT, so trail
// braking near the on level does not cut it short.
function runStart(
  lap: PedalTrace,
  section: MapSection,
  prevExitM: number,
  kind: OnsetKind,
): {atM: number | null; beyondLookBack: boolean} {
  const first = section.parts?.[0] ?? section;
  let lookBackM = LOOK_BACK_M;
  if (lap.speedKmh) {
    const at = lap.distM.findIndex(d => d >= first.turnInM);
    if (at >= 0)
      lookBackM = Math.min(
        MAX_LOOK_BACK_M,
        (lap.speedKmh[at] / 3.6) * LOOK_BACK_S,
      );
  }
  const limit = first.turnInM - lookBackM;
  const from = Math.max(prevExitM, limit);
  let entry = -1;
  for (let i = lap.distM.length - 1; i >= 0; i--) {
    const d = lap.distM[i];
    if (d > first.exitM) continue;
    if (d < from) break;
    let working: boolean;
    if (kind === 'lift') {
      working = lap.throttlePct[i] < LIFT_BELOW_PCT;
    } else {
      const v = lap.brakePct[i];
      working =
        v >= BRAKE_ON_PCT || (entry === i + 1 && v >= BRAKE_RELEASED_PCT);
    }
    if (working) entry = i;
    else if (entry >= 0 && d < first.turnInM) break;
  }
  if (entry < 0) return {atM: null, beyondLookBack: false};
  // A run still going at the look-back limit has no onset we can see: the
  // limit is not where it began. (A run held by the previous exit is a real
  // onset for this section, the boundary clamps to that exit anyway.)
  const beyondLookBack =
    limit > prevExitM && (entry === 0 || lap.distM[entry - 1] < from);
  return {atM: beyondLookBack ? null : lap.distM[entry], beyondLookBack};
}

/**
 * Where a lap began braking (`kind` 'brake') or lifting ('lift') for a section,
 * or null when it did neither before turn-in, or its run goes back past the
 * look-back (`beyondLookBack`: no onset we can see, not a fake one at the
 * limit). Distances are the lap's own, so a brake that began before the line is
 * not this lap's.
 */
export function onsetOf(
  lap: PedalTrace,
  section: MapSection,
  prevExitM: number,
  kind: OnsetKind = 'brake',
): {atM: number | null; beyondLookBack: boolean} {
  return runStart(lap, section, prevExitM, kind);
}

/** `onsetOf`'s distance alone. */
export function onsetM(
  lap: PedalTrace,
  section: MapSection,
  prevExitM: number,
  kind: OnsetKind = 'brake',
): number | null {
  return runStart(lap, section, prevExitM, kind).atM;
}

/**
 * One onset per lap for a section, and which kind they are. A section that
 * most laps brake for is measured by brake onsets alone, so a lift-and-coast
 * lap cannot move it; a section nobody brakes for (a fast kink) is measured by
 * lift onsets; a corner taken flat gives no onset at all; a lap whose run goes
 * back past the look-back gives none either, counted in `beyondLookBack`. Pass
 * comparable green laps only: a lap under yellow, off track or through the pit lane is not a
 * measure of where the laps agree.
 */
export function onsetsOfLaps(
  laps: PedalTrace[],
  section: MapSection,
  prevExitM: number,
  forceKind?: OnsetKind,
): {kind: OnsetKind; onsetsM: (number | null)[]; beyondLookBack: number} {
  if (forceKind) {
    const os = laps.map(l => onsetOf(l, section, prevExitM, forceKind));
    return {
      kind: forceKind,
      onsetsM: os.map(o => o.atM),
      beyondLookBack: os.filter(o => o.beyondLookBack).length,
    };
  }
  const brake = laps.map(l => onsetOf(l, section, prevExitM, 'brake'));
  const braked = brake.filter(o => o.atM != null || o.beyondLookBack).length;
  const pick = (os: {atM: number | null; beyondLookBack: boolean}[]) => ({
    onsetsM: os.map(o => o.atM),
    beyondLookBack: os.filter(o => o.beyondLookBack).length,
  });
  if (laps.length > 0 && braked / laps.length >= BRAKED_SHARE) {
    return {kind: 'brake', ...pick(brake)};
  }
  return {
    kind: 'lift',
    ...pick(laps.map(l => onsetOf(l, section, prevExitM, 'lift'))),
  };
}

/**
 * One session's laps measured for a section: the brake onset and the lift
 * onset of every lap (null where there was none), how many laps there were and
 * how many braked for it. Both kinds are kept so the layout can decide which
 * one the section is by the majority of every lap pooled, and change its mind
 * (`foldBoundaries`).
 */
export interface SectionOnsets {
  laps: number;
  braked: number;
  brakeM: (number | null)[];
  liftM: (number | null)[];
  /**
   * The median speed of these laps at the section's map entry, km/h: what the
   * margin in seconds is turned into metres with. Part of the pool, not read
   * from whichever session folds last, so the same pools always give the same
   * boundaries.
   */
  speedKmh: number | null;
}

export function lapOnsets(
  laps: PedalTrace[],
  section: MapSection,
  prevExitM: number,
): SectionOnsets {
  const brake = laps.map(l => onsetOf(l, section, prevExitM, 'brake'));
  const lift = laps.map(l => onsetOf(l, section, prevExitM, 'lift'));
  const speeds = laps
    .map(l => {
      const i = l.distM.findIndex(d => d >= section.entryM);
      return i >= 0 ? l.speedKmh?.[i] : undefined;
    })
    .filter((v): v is number => v != null && Number.isFinite(v))
    .sort((a, b) => a - b);
  return {
    laps: laps.length,
    braked: brake.filter(o => o.atM != null || o.beyondLookBack).length,
    brakeM: brake.map(o => o.atM),
    liftM: lift.map(o => o.atM),
    speedKmh: speeds.length ? speeds[speeds.length >> 1] : null,
  };
}

/** Onsets of one section, binned: `brake[i]` laps began braking in bin i, which starts at `binFromM + i * ONSET_BIN_M`; `lift` the same for lifts. */
export interface OnsetPool {
  laps: number;
  braked: number;
  speedKmh: number | null;
  binFromM: number;
  brake: number[];
  lift: number[];
}

const binFrom = (section: MapSection, prevExitM: number): number => {
  const first = section.parts?.[0] ?? section;
  const from = Math.max(prevExitM, first.turnInM - MAX_LOOK_BACK_M);
  return Math.floor(from / ONSET_BIN_M) * ONSET_BIN_M;
};

/** The pools of one session: per section, its laps' onsets binned. */
export function onsetPools(
  sections: MapSection[],
  onsets: SectionOnsets[],
): OnsetPool[] {
  return sections.map((s, k) => {
    const first = s.parts?.[0] ?? s;
    const binFromM = binFrom(s, k > 0 ? sections[k - 1].exitM : 0);
    const size = Math.max(
      1,
      Math.ceil((first.exitM - binFromM) / ONSET_BIN_M) + 1,
    );
    const bin = (ms: (number | null)[]) => {
      const counts = new Array<number>(size).fill(0);
      for (const m of ms) {
        if (m == null || !Number.isFinite(m)) continue;
        const i = Math.floor((m - binFromM) / ONSET_BIN_M);
        counts[Math.min(size - 1, Math.max(0, i))]++;
      }
      return counts;
    };
    const o = onsets[k];
    return {
      laps: o?.laps ?? 0,
      braked: o?.braked ?? 0,
      speedKmh: o?.speedKmh ?? null,
      binFromM,
      brake: bin(o?.brakeM ?? []),
      lift: bin(o?.liftM ?? []),
    };
  });
}

/**
 * What the layout keeps (on the track's boundary doc): every session's onset
 * pools (so a resync replaces its own), the windows' starts, the margin in
 * metres within which a later change is not worth moving a boundary for, and
 * `rev`, which counts the moves worth making: a session analysed on an older
 * `rev` has times cut at boundaries that have since moved.
 */
export interface Boundaries {
  v: number;
  rev: number;
  /** Per section, what its onsets are: brake where most pooled laps brake for it, else lift; decided again at every fold. */
  kinds: OnsetKind[];
  sessions: Record<string, OnsetPool[]>;
  /** Per section, the reference onset the start rests on; null while provisional. */
  earliestOnsetM: (number | null)[];
  /** Per section, where its window starts. */
  startsM: number[];
  /** Per section, the margin in metres at the speed there. */
  marginM: number[];
}

// The pooled laps of one section across sessions: how many, how many braked,
// from how many sessions, and the onsets of `kind` binned.
function pooled(
  sessions: Record<string, OnsetPool[]>,
  k: number,
  kind: OnsetKind,
): {
  laps: number;
  braked: number;
  onsets: number;
  sessions: number;
  binFromM: number;
  counts: number[];
} {
  let counts: number[] = [];
  let binFromM = 0;
  let laps = 0;
  let braked = 0;
  let onsets = 0;
  let n = 0;
  for (const pools of Object.values(sessions)) {
    const p = pools[k];
    if (!p || p.laps === 0) continue;
    const mine = kind === 'brake' ? p.brake : p.lift;
    if (counts.length === 0) {
      binFromM = p.binFromM;
      counts = new Array<number>(mine.length).fill(0);
    }
    mine.forEach((c, i) => {
      if (i < counts.length) counts[i] += c;
    });
    laps += p.laps;
    braked += p.braked;
    onsets += mine.reduce((a, b) => a + b, 0);
    n++;
  }
  return {laps, braked, onsets, sessions: n, binFromM, counts};
}

// The lower edge of the bin that holds the q-th share of the pooled laps.
function quantileM(
  binFromM: number,
  counts: number[],
  laps: number,
  q: number,
) {
  const target = Math.max(1, Math.ceil(q * laps));
  let seen = 0;
  for (let i = 0; i < counts.length; i++) {
    seen += counts[i];
    if (seen >= target) return binFromM + i * ONSET_BIN_M;
  }
  return null;
}

/** The speed-dependent margin and the start of every section's window. */
function boundaryStarts(input: {
  sections: MapSection[];
  earliestOnsetM: (number | null)[];
  speedKmh: number[];
  marginS: number;
}): {startsM: number[]; marginM: number[]} {
  const {sections, earliestOnsetM, speedKmh, marginS} = input;
  const startsM: number[] = [];
  const marginM: number[] = [];
  sections.forEach((s, k) => {
    // The map's entry is the median onset, so it never falls before the
    // reference onset; it stands in while the pool is too small, and for a
    // corner nobody brakes or lifts for (taken flat, its entry is the turn-in
    // the map found from the track's curvature).
    const seen = earliestOnsetM[k];
    const reference = seen == null ? s.entryM : Math.min(s.entryM, seen);
    const margin = (speedKmh[k] / 3.6) * marginS;
    const floor = k > 0 ? sections[k - 1].exitM : 0;
    const start = Math.max(floor, reference - margin, startsM[k - 1] ?? 0);
    startsM.push(Math.min(start, s.turnInM));
    marginM.push(margin);
  });
  return {startsM, marginM};
}

/**
 * Fold one session's onset pools into what the layout keeps. The windows move
 * only when some section's start would shift by more than its margin, in
 * either direction; then `rev` goes up, so a few metres of drift do not re-cut
 * every session. A layout with nothing stored starts at rev 1; one stored under
 * another rule version is replaced, with a higher rev.
 *
 * `moved` is true when the windows moved on a layout that already had some (a
 * session analysed on the old rev is stale); `changed` when anything stored
 * differs, so the doc needs writing.
 */
export function foldBoundaries(input: {
  sections: MapSection[];
  stored: Boundaries | null;
  sessionId: string;
  pools: OnsetPool[];
  marginS?: number;
  quantile?: number;
  minLaps?: number;
  minSessions?: number;
}): {boundaries: Boundaries; moved: boolean; changed: boolean} {
  const {sections, stored, sessionId, pools} = input;
  const marginS = input.marginS ?? BOUNDARY_MARGIN_S;
  const quantile = input.quantile ?? EARLIEST_QUANTILE;
  const minLaps = input.minLaps ?? MIN_POOL_LAPS;
  const minSessions = input.minSessions ?? MIN_POOL_SESSIONS;
  const usable =
    stored != null &&
    stored.v === CORNER_BOUNDARIES_VERSION &&
    stored.startsM.length === sections.length;
  const sessions = {...(usable ? stored.sessions : {}), [sessionId]: pools};
  // What each section's onsets are, from every lap pooled: brake where most
  // brake for it, else lift. A flip moves the boundary and what `onsetM` means
  // on every lap, so it is a move of the windows (the rev goes up).
  const kinds: OnsetKind[] = sections.map((_, k) => {
    const all = pooled(sessions, k, 'brake');
    if (all.laps === 0) return usable ? stored.kinds[k] : 'brake';
    return all.braked / all.laps >= BRAKED_SHARE ? 'brake' : 'lift';
  });
  const earliestOnsetM = sections.map((_, k) => {
    const p = pooled(sessions, k, kinds[k]);
    if (p.onsets < minLaps || p.sessions < minSessions) return null;
    return quantileM(p.binFromM, p.counts, p.onsets, quantile);
  });
  // The speed the margin is turned into metres at: the median of the sessions'
  // own medians at the section's entry (180 km/h where none was measured).
  const speedKmh = sections.map((_, k) => {
    const v = Object.values(sessions)
      .map(p => p[k]?.speedKmh)
      .filter((x): x is number => x != null)
      .sort((a, b) => a - b);
    return v.length ? v[v.length >> 1] : DEFAULT_SPEED_KMH;
  });
  const cut = boundaryStarts({sections, earliestOnsetM, speedKmh, marginS});
  if (!usable) {
    const boundaries: Boundaries = {
      v: CORNER_BOUNDARIES_VERSION,
      rev: (stored?.rev ?? 0) + 1,
      kinds,
      sessions,
      earliestOnsetM,
      ...cut,
    };
    return {boundaries, moved: false, changed: true};
  }
  const flipped = kinds.some((kind, k) => kind !== stored.kinds[k]);
  const moved =
    flipped ||
    cut.startsM.some(
      (m, k) => Math.abs(m - stored.startsM[k]) > stored.marginM[k],
    );
  const boundaries: Boundaries = moved
    ? {...stored, rev: stored.rev + 1, kinds, sessions, earliestOnsetM, ...cut}
    : {...stored, kinds, sessions, earliestOnsetM};
  const same =
    JSON.stringify(stored.sessions[sessionId]) === JSON.stringify(pools);
  const sameEarliest = earliestOnsetM.every(
    (m, k) => m === stored.earliestOnsetM[k],
  );
  return {boundaries, moved, changed: moved || !same || !sameEarliest};
}

/** The windows that tile the lap from stored boundaries. */
export function windowsOf(
  boundaries: Pick<Boundaries, 'startsM'>,
  sections: MapSection[],
  lengthM: number,
): CornerWindow[] {
  const starts = boundaries.startsM;
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
    const fromM = starts[k];
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

/**
 * The windows that tile the lap, from the line to the line, from the onsets of
 * a set of laps at the layout: the fold from nothing, taking them as
 * established (no minimum of laps or sessions). `onsetsM` is, per section, one
 * onset per lap. Boundaries never fall behind the previous section's exit. A
 * start straight is returned only when the first boundary is past the line.
 */
export function cornerBoundaries(input: {
  lengthM: number;
  sections: MapSection[];
  onsetsM: (number | null)[][];
  speedKmhAt: (m: number) => number;
  marginS?: number;
  quantile?: number;
}): CornerWindow[] {
  const pools = onsetPools(
    input.sections,
    input.onsetsM.map((onsetsM, k) => ({
      laps: onsetsM.length,
      braked: onsetsM.filter(m => m != null).length,
      brakeM: onsetsM,
      liftM: [],
      speedKmh: input.speedKmhAt(input.sections[k].entryM),
    })),
  );
  const {boundaries} = foldBoundaries({
    ...input,
    stored: null,
    sessionId: 'laps',
    pools,
    minLaps: 1,
    minSessions: 1,
  });
  return windowsOf(boundaries, input.sections, input.lengthM);
}

// A compound section's parts tile its window: each part starts at the map's
// entry for it (the brake or the steering reversal) and the last ends where the
// window does. A single corner has no parts of its own to list.
function partWindows(s: MapSection, fromM: number, toM: number): PartWindow[] {
  const parts = s.parts ?? [];
  if (parts.length < 2) return [];
  return parts.map((p, i) => ({
    n: p.n,
    turnInM: p.turnInM,
    fromM: i === 0 ? fromM : Math.min(Math.max(p.entryM, fromM), toM),
    toM:
      i + 1 < parts.length
        ? Math.min(Math.max(parts[i + 1].entryM, fromM), toM)
        : toM,
  }));
}

/**
 * Where a lap reaches full throttle in a window and stays there: the first
 * sample at FULL_THROTTLE_PCT or more that holds for FULL_THROTTLE_HOLD_S (a
 * flick of the pedal mid-chicane does not count); failing that, the first at
 * PARTIAL_THROTTLE_PCT held for PARTIAL_THROTTLE_HOLD_S, for a traction-limited
 * exit that never sits at full. Null when neither is reached. A hold cut short
 * by the window's end counts if the pedal stays up to it. Needs `timeS`.
 */
export function fullThrottlePointM(
  lap: PedalTrace,
  window: {fromM: number; toM: number},
): number | null {
  const t = lap.timeS;
  if (!t) return null;
  const holds = (i: number, level: number, holdS: number) => {
    for (let j = i; j < lap.distM.length; j++) {
      if (lap.distM[j] >= window.toM) return true;
      if (lap.throttlePct[j] < level) return false;
      if (t[j] - t[i] >= holdS) return true;
    }
    return true;
  };
  for (const [level, holdS] of [
    [FULL_THROTTLE_PCT, FULL_THROTTLE_HOLD_S],
    [PARTIAL_THROTTLE_PCT, PARTIAL_THROTTLE_HOLD_S],
  ]) {
    for (let i = 0; i < lap.distM.length; i++) {
      const d = lap.distM[i];
      if (d < window.fromM) continue;
      if (d >= window.toM) break;
      if (lap.throttlePct[i] >= level && holds(i, level, holdS)) return d;
    }
  }
  return null;
}

/** The time a window takes in one lap, split where the pedals say. */
export interface WindowSplit {
  /** From the boundary to the lap's onset: the straight before the corner. */
  runInS: number;
  /** From the onset to full throttle. */
  cornerS: number;
  /** From full throttle to the next boundary. */
  exitS: number;
}

/**
 * One lap's window time split into run-in, corner and exit, the three adding up
 * to the window's time. `onsetM` is the lap's own onset for the section, the
 * same one the boundary rests on (a brake onset, or a lift onset where the
 * section is a lift section), and `fullThrottleAtM` its full-throttle point
 * (`fullThrottlePointM`); null: no onset, or never full throttle. They are
 * clamped into the window and kept in order. With no onset the corner starts at
 * the window; with no full throttle it runs to the window's end.
 */
export function splitWindow(
  timeAt: (m: number) => number,
  window: {fromM: number; toM: number},
  points: {onsetM: number | null; fullThrottleAtM: number | null},
): WindowSplit {
  const {fromM, toM} = window;
  const clamp = (m: number) => Math.min(toM, Math.max(fromM, m));
  const onset = clamp(points.onsetM ?? fromM);
  const full = Math.max(onset, clamp(points.fullThrottleAtM ?? toM));
  const t0 = timeAt(fromM);
  return {
    runInS: timeAt(onset) - t0,
    cornerS: timeAt(full) - timeAt(onset),
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
 * rule `pedalPoints.mjs` uses). An application belongs to the corner it is
 * braking FOR: the first part that turns in after its onset (or the last), not
 * the part whose window holds it, which starts at the map's median entry, so a
 * lap that brakes for T9 earlier than the median would read as braking in T8.
 * The bus stop is two of these across three parts.
 */
export function brakeApplications(
  lap: Pick<PedalTrace, 'distM' | 'brakePct'>,
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
      const part =
        window.parts.find(p => p.turnInM > d) ??
        window.parts[window.parts.length - 1];
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
