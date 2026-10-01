// What the cars around the player did to a lap, beyond the seconds and counts
// in tools/sessions/fieldTags.mjs: the faster-class cars that passed the
// player (where), and the session's clean and traffic laps (pit-wall thread
// 44, E2). Plain TypeScript with erasable syntax only, no imports: Node runs
// it. The sim's class strings are parsed by the caller (`pace`), so there is
// one place that does it (src/analysis/classLaps.ts).

/** The encoded field file (docs/API.md), only the columns this reads. */
export interface TrafficField {
  /** The session clock at the first update, seconds. */
  et0: number;
  /** Tenths of a second from `et0`, one per update. */
  tDs: number[];
  cars: {class: string; player?: boolean}[];
  /** Per car, deltas in decimetres; null = the car was absent. */
  lapDistDm: (number | null)[][];
  inPits: (number | null)[][];
}

/** A class as the caller parses it: a stable key and how fast it is (higher is faster). */
export interface PaceOf {
  key: string;
  rank: number;
}

export interface Overtake {
  /** The class of the car that passed. */
  cls: string;
  /** The player's lap distance when it did, metres. */
  atM: number;
}

// A pass is the on-road gap changing sign while both cars are this close, the
// same rule as the pass counts in fieldTags.mjs.
export const PASS_WINDOW_M = 150;

const undeltaM = (values: (number | null)[]): (number | null)[] => {
  let last = 0;
  return values.map(d => (d === null ? null : (last += d) / 10));
};

// Signed on-road distance from a to b, in (-L/2, L/2]: positive when b is ahead of a.
const ahead = (a: number, b: number, lengthM: number) =>
  ((((b - a) % lengthM) + 1.5 * lengthM) % lengthM) - lengthM / 2;

/**
 * Per window ({from, to} on the session clock, `from` inclusive), the cars of
 * a faster class that went from behind the player to ahead of them. Cars in
 * the pits and cars of the player's own or a slower class are left out: a
 * Hypercar lapping a GT3 is the case this is for. Empty lists when the field
 * has no player car.
 */
export function overtakesOf(
  field: TrafficField,
  windows: {from: number; to: number}[],
  pace: (carClass: string) => PaceOf,
): Overtake[][] {
  const out: Overtake[][] = windows.map(() => []);
  const me = field.cars.findIndex(c => c.player === true);
  if (me < 0) return out;
  const etS = field.tDs.map(d => field.et0 + d / 10);
  const dist = field.lapDistDm.map(undeltaM);
  let lengthM = 0;
  for (const row of dist)
    for (const d of row) if (d !== null && d > lengthM) lengthM = d;
  if (lengthM === 0) return out;
  const mine = pace(field.cars[me].class);
  const player = dist[me];

  field.cars.forEach((c, j) => {
    if (j === me) return;
    const theirs = pace(c.class);
    if (theirs.rank <= mine.rank) return;
    // The last gap that was not exactly 0 m (decimetre positions make a gap
    // of 0 m a real sample, neither ahead nor behind), cleared while either
    // car is absent or in the pits.
    let last: number | null = null;
    for (let u = 0; u < etS.length; u++) {
      const a = player[u];
      const b = dist[j][u];
      if (
        a === null ||
        b === null ||
        field.inPits[me][u] === 1 ||
        field.inPits[j][u] === 1
      ) {
        last = null;
        continue;
      }
      const gap = ahead(a, b, lengthM);
      if (gap === 0) continue;
      if (last !== null && last < 0 && gap > 0) {
        if (Math.abs(last) < PASS_WINDOW_M && gap < PASS_WINDOW_M) {
          const w = windows.findIndex(x => etS[u] >= x.from && etS[u] < x.to);
          if (w >= 0) out[w].push({cls: theirs.key, atM: Math.round(a)});
        }
      }
      last = gap;
    }
  });
  for (const list of out) list.sort((x, y) => x.atM - y.atM);
  return out;
}

/** Bump when the rules in this file or in lapFieldFacts change: a stale block is recomputed. */
export const TRAFFIC_VERSION = 3;

// A clean lap is free air: under CLEAN_AHEAD_S behind a car, and not passed by
// any car (a Hypercar lapping a GT3 is a pass that `passesSuffered`, which is
// the player's class only, does not count), no blue flag, under CLEAN_BATTLE_S of battle, and no faster-class
// overtake. A traffic lap is TRAFFIC_AHEAD_S or more behind a car.
//
// A clean lap and a traffic lap are two sets that do not touch: a lap with
// 2 to 5 s behind a car is in neither. That gap is deliberate, so nobody
// merges them into one threshold: the evidence (the two full Daytona fields,
// 534 timed laps) shows no lap-time cost of running within 1 s behind a car,
// and most laps in a pack race are traffic laps, so the clean set is the
// front-runners and a "traffic costs X seconds" number would be selection.
export const CLEAN_AHEAD_S = 2;
export const TRAFFIC_AHEAD_S = 5;
// A same-class car close behind is defended against, which costs time as
// surely as following one (setup, pit-wall thread 44 #1539): a clean lap has
// under this many seconds of battle, ahead or behind.
export const CLEAN_BATTLE_S = 2;
// Fewer laps than this has no median (the floor used everywhere else).
export const MIN_SET_LAPS = 3;

export interface TrafficLap {
  timeS: number | null;
  comparable: boolean;
  traffic: {
    trafficAheadS: number;
    /** Passes by any car, not only the player's class. */
    passesSufferedAll: number;
    blueFlagS: number;
    /** Seconds within 1 s of a car of the player's class, ahead or behind. */
    battleS: number;
    overtakes: unknown[];
  } | null;
}

export interface LapSet {
  laps: number;
  /** Null under MIN_SET_LAPS laps. */
  medianS: number | null;
}

/** The session doc's `traffic`: the clean and the traffic laps, side by side. */
export interface SessionTraffic {
  v: number;
  clean: LapSet;
  traffic: LapSet;
}

function setOf(times: number[]): LapSet {
  if (times.length < MIN_SET_LAPS) return {laps: times.length, medianS: null};
  const s = [...times].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const m = s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return {laps: s.length, medianS: Math.round(m * 1000) / 1000};
}

/**
 * Clean and traffic laps over the comparable laps. Null when no lap has
 * traffic facts (a session without a field).
 */
export function trafficMedians(laps: TrafficLap[]): SessionTraffic | null {
  const known = laps.filter(
    l => l.comparable && l.timeS !== null && l.traffic !== null,
  );
  if (!laps.some(l => l.traffic !== null)) return null;
  const times = (pick: (t: NonNullable<TrafficLap['traffic']>) => boolean) =>
    known.filter(l => pick(l.traffic!)).map(l => l.timeS as number);
  return {
    v: TRAFFIC_VERSION,
    clean: setOf(
      times(
        t =>
          t.trafficAheadS < CLEAN_AHEAD_S &&
          t.passesSufferedAll === 0 &&
          t.blueFlagS === 0 &&
          t.battleS < CLEAN_BATTLE_S &&
          t.overtakes.length === 0,
      ),
    ),
    traffic: setOf(times(t => t.trafficAheadS >= TRAFFIC_AHEAD_S)),
  };
}
