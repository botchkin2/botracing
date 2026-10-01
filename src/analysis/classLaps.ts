// Lap times of every class in a race, from the encoded field (docs/API.md,
// GET /sessions/{id}/field/{hash}): the faster classes' pace for the Plan's
// class timing (pit-wall thread 44, round 6 section 2). The uploader
// (tools/sessions/sync.mjs) computes it once per session and stores it as the
// session doc's `classLaps`, so the app never downloads a field to draw the
// Plan. Plain TypeScript with erasable syntax only, no imports: Node runs it.
//
// The field has no lap times. A car's lap is the time between two crossings
// of the line, found where its lap distance wraps from the end of the lap to
// the start, interpolated between the two updates either side (a 5 Hz update
// can sit up to 0.2 s after the line, which would smear p10 and p90).

/** The encoded field file, only the columns this reads. */
export interface EncodedField {
  hz: number;
  /** Tenths of a second from `et0`, one per update. */
  tDs: number[];
  cars: {class: string}[];
  /** Per car, deltas in decimetres; null = the car was absent. */
  lapDistDm: (number | null)[][];
  inPits: (number | null)[][];
  flag: (number | null)[][];
}

/**
 * Pace classes. Not the Race screen's colour classes: GTE is a different car
 * from a GT3 and laps at a different pace, so it keeps its own key here;
 * "LMGT3" is the WEC name of the GT3 class. Anything else pools as `other`.
 */
export type PaceClass = 'hypercar' | 'lmp2' | 'gt3' | 'gte' | 'other';

export function paceClass(carClass: string): PaceClass {
  const c = carClass.toLowerCase();
  if (c.startsWith('hyper') || c === 'lmh' || c === 'lmdh') return 'hypercar';
  if (c.startsWith('lmp2')) return 'lmp2';
  if (c.startsWith('gt3') || c === 'lmgt3') return 'gt3';
  if (c.startsWith('gte') || c === 'lmgte') return 'gte';
  return 'other';
}

export interface ClassLapStats {
  cars: number;
  laps: number;
  medianS: number;
  p10S: number;
  p90S: number;
}
export type ClassLaps = Partial<Record<PaceClass, ClassLapStats>>;

/**
 * Bump when the rules below change: a stored `classLaps` from an older
 * version is recomputed from the uploaded field (tools/sessions/store.mjs).
 */
export const CLASS_LAPS_VERSION = 1;

// A lap slower than this times the class median is a spin, a slow car or an
// unflagged crash, not pace.
export const SLOW_CUT = 1.15;
// A lap faster than this times the class median is not a lap: nobody finds
// 5 % in a green lap, so the car covered less than a lap (a reset to the
// garage, a teleport) or the wrap was not the line.
export const FAST_CUT = 0.95;
// Fewer than this many laps is not a class pace.
export const MIN_CLASS_LAPS = 3;

// The wrap: from the last 30% of the lap to the first 30%.
const WRAP_FROM = 0.7;
const WRAP_TO = 0.3;
// A crossing lands at a distance of zero or more. At the start of the
// Daytona races of 2026-09-29/30 every car's lap distance drops by one lap, to
// about -450 m, at the same update (120.8 s): the counter changes over 450 m
// before the line and reads negative until the car reaches it. That wrap is
// continuous on the road (a 1 m step), so only the sign tells it from a
// crossing; taking it for one started each car's clock up to 26 s early or
// late (the time was extrapolated from a rolling start's speed) and made a
// first "lap" of 95-99 s against a 110 s GT3 pace.
//
// A real crossing also moves the car one step: the distance to the end of the
// lap plus the distance past the start is what it drove in one update. 120 m/s
// (430 km/h) is above any car; the slack covers the track length being only
// the longest distance seen, short of the real one by up to a step. A jump
// that is bigger (a reset to the garage, a teleport) is not a crossing.
const MAX_SPEED_MS = 120;
const STEP_SLACK_M = 20;

const undelta = (values: (number | null)[]): (number | null)[] => {
  let last = 0;
  return values.map(d => (d === null ? null : (last += d)));
};

// When the car crossed the line, between updates u-1 and u (lap distance
// `prev` before the line, `lapDistM[u]` after). The track length is only the
// longest distance seen, so the time comes from the speed just after the
// line: the car was `d / v` seconds past it at update u. The length is the
// fallback when there is no clean update after.
function crossingT(
  lapDistM: (number | null)[],
  etS: number[],
  u: number,
  prev: number,
  lengthM: number,
): number {
  const d = lapDistM[u] as number;
  const next = lapDistM[u + 1];
  if (next !== undefined && next !== null && next > d) {
    const v = (next - d) / (etS[u + 1] - etS[u]);
    return etS[u] - d / v;
  }
  const toLine = lengthM - prev;
  return etS[u - 1] + ((etS[u] - etS[u - 1]) * toLine) / (toLine + d);
}

/**
 * Green lap times per car, seconds, in the file's car order. A lap counts when
 * the car was in the field, out of the pits and under no flag for all of it.
 * The car's first crossing only starts the clock.
 */
export function carLaps(field: EncodedField): number[][] {
  const etS = field.tDs.map(d => d / 10);
  const lapDist = field.lapDistDm.map(row =>
    undelta(row).map(v => (v === null ? null : v / 10)),
  );
  let lengthM = 0;
  for (const row of lapDist)
    for (const d of row) if (d !== null && d > lengthM) lengthM = d;
  if (lengthM === 0) return field.cars.map(() => []);

  return field.cars.map((_, i) => {
    const laps: number[] = [];
    const lapDistM = lapDist[i];
    let startT: number | null = null;
    let clean = false;
    let prev: number | null = null;
    for (let u = 0; u < etS.length; u++) {
      const d = lapDistM[u];
      if (d === null) {
        clean = false;
        prev = null;
        continue;
      }
      if (field.inPits[i][u] === 1 || (field.flag[i][u] ?? 0) > 0)
        clean = false;
      if (
        prev !== null &&
        prev > WRAP_FROM * lengthM &&
        d < WRAP_TO * lengthM
      ) {
        const stepM = lengthM - prev + d;
        const dt = etS[u] - etS[u - 1];
        if (
          d >= 0 &&
          stepM >= -STEP_SLACK_M &&
          stepM <= MAX_SPEED_MS * dt + STEP_SLACK_M
        ) {
          const at = crossingT(lapDistM, etS, u, prev, lengthM);
          if (startT !== null && clean) laps.push(at - startT);
          startT = at;
          clean = true;
        } else {
          // Not the line (the counter changing over, or a jump): whatever
          // lap is running is not a lap.
          startT = null;
          clean = false;
        }
      }
      prev = d;
    }
    return laps;
  });
}

const round = (v: number) => Math.round(v * 100) / 100;

// Nearest rank on a sorted array.
function rank(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export type ClassLapsKind = 'race' | 'practice' | 'qualify';

/** The session doc's `sessionType` ("Race", "Practice", "Qualify") as the app reads it. */
export function sessionKind(sessionType: string): ClassLapsKind {
  const t = sessionType.toLowerCase();
  if (t.startsWith('r')) return 'race';
  if (t.startsWith('q')) return 'qualify';
  return 'practice';
}

/**
 * In practice a car's laps count only within this many times that car's own
 * best green lap of the session: out-laps, cool-down laps and setup runs fall
 * out (pit-wall thread 44 #1407). Races keep every green lap.
 */
export const PRACTICE_WINDOW = 1.07;

/**
 * The session doc's `classLaps`. `kind` is stored with the numbers, not
 * read back from the session type later, so a session that is re-typed
 * cannot change what they mean without a recompute; `version` is
 * CLASS_LAPS_VERSION when it was computed. `classes` is null when no class
 * reached MIN_CLASS_LAPS laps, and always for qualifying (everyone is on a
 * single-lap push, which overstates race pace): the doc is still written,
 * so a sync can tell "nothing to find" from "never computed".
 */
export interface ClassLapsDoc {
  version: number;
  kind: ClassLapsKind;
  classes: ClassLaps | null;
}

function statsOf(kept: {car: number; t: number}[]): ClassLapStats | null {
  if (kept.length < MIN_CLASS_LAPS) return null;
  const times = kept.map(l => l.t).sort((a, b) => a - b);
  return {
    cars: new Set(kept.map(l => l.car)).size,
    laps: times.length,
    medianS: round(rank(times, 0.5)),
    p10S: round(rank(times, 0.1)),
    p90S: round(rank(times, 0.9)),
  };
}

export function keptLaps(
  list: {car: number; t: number}[],
  kind: ClassLapsKind,
): {car: number; t: number}[] {
  const sorted = (xs: number[]) => xs.sort((a, b) => a - b);
  const best = new Map<number, number>();
  for (const l of list)
    best.set(l.car, Math.min(best.get(l.car) ?? Infinity, l.t));
  // What the floor is measured against. A race is mostly push laps, so its
  // median is the pace. Practice is half cool-downs and setup runs, which
  // lift the median to about 1.10x the real pace and would put the floor on
  // top of real push laps; the median of the cars' bests does not move with
  // them (one car's false short best cannot move a median either).
  const anchor =
    kind === 'race'
      ? rank(sorted(list.map(l => l.t)), 0.5)
      : rank(sorted([...best.values()]), 0.5);
  // The physical floor first: a false short lap must not become a car's
  // "best" and shrink the practice window around it.
  const real = list.filter(l => l.t >= FAST_CUT * anchor);
  if (kind === 'race') return real.filter(l => l.t <= SLOW_CUT * anchor);
  const realBest = new Map<number, number>();
  for (const l of real)
    realBest.set(l.car, Math.min(realBest.get(l.car) ?? Infinity, l.t));
  return real.filter(
    l => l.t <= PRACTICE_WINDOW * (realBest.get(l.car) as number),
  );
}

/**
 * Per class, over every car's green laps; null when no class has
 * MIN_CLASS_LAPS laps. `cars` counts cars with at least one kept lap.
 */
export function classLaps(
  field: EncodedField,
  kind: Exclude<ClassLapsKind, 'qualify'>,
): ClassLaps | null {
  const per = carLaps(field);
  const byClass = new Map<PaceClass, {car: number; t: number}[]>();
  field.cars.forEach((c, i) => {
    const key = paceClass(c.class);
    const list = byClass.get(key) ?? [];
    for (const t of per[i]) list.push({car: i, t});
    byClass.set(key, list);
  });
  const out: ClassLaps = {};
  for (const [key, list] of byClass) {
    if (list.length === 0) continue;
    const stats = statsOf(keptLaps(list, kind));
    if (stats) out[key] = stats;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** What a sync writes for a session that has a field. */
export function classLapsDoc(
  field: EncodedField,
  sessionType: string,
): ClassLapsDoc {
  const kind = sessionKind(sessionType);
  return {
    version: CLASS_LAPS_VERSION,
    kind,
    classes: kind === 'qualify' ? null : classLaps(field, kind),
  };
}

/**
 * Whether a stored `classLaps` can be kept: computed by this version of the
 * rules, for this kind of session. Anything else (an older analysis, a rule
 * change, a re-typed session) is recomputed from the uploaded field.
 */
export function classLapsCurrent(
  stored: Record<string, unknown> | null | undefined,
  sessionType: string,
): boolean {
  return (
    stored?.version === CLASS_LAPS_VERSION &&
    stored.kind === sessionKind(sessionType)
  );
}
