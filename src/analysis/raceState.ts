// The race at a moment: where every car is, what it is doing, and where it
// runs in its class. Plain TypeScript, erasable syntax only: Node runs it.
//
// Positions are the sim's world metres (x east, z north). That is the same
// frame as the trace map to within ~3 m over a lap (measured on the Daytona
// race, pit-wall thread 27 #813), so a dot needs no fit; `worldMatch.ts`
// checks it per session.
//
// The field is 5 Hz. Playing interpolates between two updates; paused snaps
// to the nearest one, so every dot is a real sample (handoff R1, 5 Hz honesty).
import {trackLengthM} from './classLaps';
import {ABSENT, type Field, updateAt} from './field';

// Handoff R1d.
export const STOPPED_KMH = 5;
export const STOPPED_FOR_S = 2;
export const OFF_TRACK_M = 7.5;
// A pit stop is a stay in the pit lane of at least this long. The whole field
// reads "in the pits" for ~3 s at the start of the Daytona race (7.6 s to
// 10.8 s, every car), and a real stop lasts a minute or more; a drive-through
// at the 60 km/h limit past a 300 m lane still takes ~18 s.
export const MIN_PIT_S = 10;

export type CarState = 'running' | 'pit' | 'stopped' | 'off' | 'garage';

export interface RaceCar {
  index: number;
  carClass: string;
  vehicle: string | null;
  player: boolean;
  xM: number;
  zM: number;
  /** Radians, 0 along +z; null in files before v2. */
  headingRad: number | null;
  lapDistM: number;
  speedKmh: number;
  state: CarState;
  /** Overall place from the game's scoring. */
  place: number;
  /** 1-based place among the cars of its class that are on the map or in the pits; 0 in the garage. */
  classPlace: number;
  lapsDone: number;
  pits: number;
  /** Seconds behind the class leader at this car's progress; 0 for the leader, null in the garage. */
  gapS: number | null;
  /** Seconds behind the car ahead in its class; null for the leader and in the garage. */
  intervalS: number | null;
  /**
   * Whole laps behind the class leader's progress (a lapped car), 0 for the
   * leader, in the garage or where the progress is unknown.
   */
  lapsDown: number;
}

/** Per-car series computed once per field, so `carsAt` stays cheap per frame. */
export interface RacePrep {
  field: Field;
  trackM: number;
  /** Unwrapped distance driven along the track, metres; NaN while absent. */
  progressM: Float32Array[];
  /** Speed from the car's own movement between updates, km/h; NaN without a previous update. */
  speedKmh: Float32Array[];
  /** Consecutive updates under STOPPED_KMH, ending at each update. */
  slowRun: Int32Array[];
  /** Pit entries so far. */
  pits: Int16Array[];
  /** First update the car is on the map; the length of the field if never. */
  firstSeen: Int32Array;
}

export function prepareRace(field: Field): RacePrep {
  const n = field.timeS.length;
  const trackM = trackLengthM(field.cars.map(c => [...c.lapDistM]));
  const progressM: Float32Array[] = [];
  const speedKmh: Float32Array[] = [];
  const slowRun: Int32Array[] = [];
  const pits: Int16Array[] = [];
  const firstSeen = new Int32Array(field.cars.length).fill(n);
  field.cars.forEach((c, i) => {
    const prog = new Float32Array(n).fill(NaN);
    const speed = new Float32Array(n).fill(NaN);
    const slow = new Int32Array(n);
    const pit = new Int16Array(n);
    let lastDist = NaN;
    let lastProg = NaN;
    let lastU = -1;
    let count = 0;
    let wasIn = 1; // starting in the pit lane is not an entry
    for (let u = 0; u < n; u++) {
      const d = c.lapDistM[u];
      if (Number.isNaN(d)) {
        pit[u] = count;
        continue;
      }
      if (firstSeen[i] === n) firstSeen[i] = u;
      if (trackM === 0) {
        prog[u] = NaN;
      } else if (Number.isNaN(lastProg)) {
        // First sight. A car still behind the start line on the first lap can
        // report a distance near the lap's end (or a negative one, as LMU
        // does on the grid): it is behind the line, not a lap ahead.
        const behindLine = c.lapsDone[u] === 0 && d > trackM * 0.75;
        prog[u] = behindLine ? d - trackM : c.lapsDone[u] * trackM + d;
      } else {
        let step = d - lastDist;
        if (step < -trackM / 2) step += trackM;
        else if (step > trackM / 2) step -= trackM;
        prog[u] = lastProg + step;
      }
      if (lastU >= 0) {
        const dt = field.timeS[u] - field.timeS[lastU];
        const moved = Math.hypot(c.xM[u] - c.xM[lastU], c.zM[u] - c.zM[lastU]);
        if (dt > 0) speed[u] = (moved / dt) * 3.6;
      }
      slow[u] = speed[u] < STOPPED_KMH ? (u > 0 ? slow[u - 1] : 0) + 1 : 0;
      const inPit = c.inPits[u];
      if (inPit === 1 && wasIn === 0) {
        const stay = stayS(field, c.inPits, u);
        // A stay that runs to the last sample is a tow or a DNF, not a stop
        // (2 Oct Road Atlanta, inPits from 1903 s to EOF).
        // Formation: LMU sets inPits after t=0 while lapsDone is still 0
        // (38 of 54 cars at 10 s on that race). Not a stop.
        if (
          raceHasStarted(field, u) &&
          Number.isFinite(stay) &&
          stay >= MIN_PIT_S
        )
          count++;
      }
      if (inPit !== ABSENT) wasIn = inPit;
      pit[u] = count;
      lastDist = d;
      lastProg = prog[u];
      lastU = u;
    }
    progressM.push(prog);
    speedKmh.push(speed);
    slowRun.push(slow);
    pits.push(pit);
  });
  return {field, trackM, progressM, speedKmh, slowRun, pits, firstSeen};
}

// How long the car stays in the pit lane from update `u`, seconds; runs to
// the end of the data count as long enough (a stop in progress).
function stayS(field: Field, inPits: Int8Array, u: number): number {
  const n = inPits.length;
  let end = u;
  while (end + 1 < n && inPits[end + 1] === 1) end++;
  if (end === n - 1) return Infinity;
  return field.timeS[end + 1] - field.timeS[u];
}

function raceHasStarted(field: Field, u: number): boolean {
  for (const c of field.cars) {
    if (c.lapsDone[u] > 0) return true;
  }
  return false;
}

function stateOf(prep: RacePrep, car: number, u: number): CarState {
  const c = prep.field.cars[car];
  if (Number.isNaN(c.lapDistM[u])) return 'garage';
  if (c.inPits[u] === 1) {
    return raceHasStarted(prep.field, u) ? 'pit' : 'running';
  }
  if (prep.slowRun[car][u] / prep.field.hz >= STOPPED_FOR_S) return 'stopped';
  if (Math.abs(c.pathLateralM[u]) > OFF_TRACK_M) return 'off';
  return 'running';
}

// When a car's progress reached `progressM`, by linear interpolation between
// updates, looking no later than update `upTo`; null if it had not. Scans back
// from `upTo`: the car being asked about passed that spot recently, so this is
// a few hundred steps however long the race has run. Progress only goes
// backwards on a spin or a reset; the latest crossing is the one that counts.
function timeAtProgress(
  prep: RacePrep,
  car: number,
  progressM: number,
  upTo: number,
): number | null {
  const prog = prep.progressM[car];
  const times = prep.field.timeS;
  let after = -1; // the earliest update seen at or past progressM
  for (let u = upTo; u >= 0; u--) {
    const p = prog[u];
    if (Number.isNaN(p)) continue;
    if (p >= progressM) {
      after = u;
      continue;
    }
    if (after < 0) return null; // the car is behind it now
    const span = prog[after] - p;
    const f = span > 0 ? (progressM - p) / span : 1;
    return times[u] + f * (times[after] - times[u]);
  }
  // Never below it: it was already there when first seen.
  return after < 0 ? null : times[after];
}

const wrapPi = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/**
 * Every car that has been on the map by `timeS` (seconds from the first
 * update). `snap` uses the nearest update; otherwise positions and heading
 * interpolate between the two updates around `timeS`, and a car absent from
 * either one is not blended. Cars are in file order.
 */
export function carsAt(
  prep: RacePrep,
  timeS: number,
  snap: boolean,
): RaceCar[] {
  const {field} = prep;
  const n = field.timeS.length;
  if (n === 0) return [];
  const u = updateAt(field.timeS, timeS);
  let lo = u;
  let hi = u;
  let f = 0;
  if (!snap) {
    lo = timeS < field.timeS[u] ? Math.max(0, u - 1) : u;
    hi = Math.min(n - 1, lo + 1);
    const span = field.timeS[hi] - field.timeS[lo];
    f =
      span > 0 ? Math.min(1, Math.max(0, (timeS - field.timeS[lo]) / span)) : 0;
  }
  const cars: RaceCar[] = [];
  const st = standingsAt(prep, u);
  const orNull = (v: number) => (Number.isNaN(v) ? null : v);
  field.cars.forEach((c, i) => {
    if (prep.firstSeen[i] > u) return;
    const blend =
      !snap && lo !== hi && !Number.isNaN(c.xM[lo]) && !Number.isNaN(c.xM[hi]);
    const at = (a: Float32Array) =>
      blend ? a[lo] + (a[hi] - a[lo]) * f : a[u];
    let heading: number | null = null;
    if (c.yawRad && !Number.isNaN(c.yawRad[u])) {
      heading = blend
        ? wrapPi(c.yawRad[lo] + wrapPi(c.yawRad[hi] - c.yawRad[lo]) * f)
        : c.yawRad[u];
    }
    const state = stateOf(prep, i, u);
    cars.push({
      index: c.index,
      carClass: c.carClass,
      vehicle: c.vehicle,
      player: c.player,
      // In the garage the last position is kept but never drawn.
      xM: state === 'garage' ? lastKnown(c.xM, u) : at(c.xM),
      zM: state === 'garage' ? lastKnown(c.zM, u) : at(c.zM),
      headingRad: state === 'garage' ? null : heading,
      lapDistM: state === 'garage' ? NaN : at(c.lapDistM),
      speedKmh: Number.isNaN(prep.speedKmh[i][u]) ? 0 : prep.speedKmh[i][u],
      state,
      place: c.place[u],
      classPlace: st.classPlace[i],
      lapsDone: c.lapsDone[u],
      pits: prep.pits[i][u],
      gapS: orNull(st.gapS[i]),
      intervalS: orNull(st.intervalS[i]),
      lapsDown: st.lapsDown[i],
    });
  });
  return cars;
}

function lastKnown(a: Float32Array, u: number): number {
  for (let k = u; k >= 0; k--) if (!Number.isNaN(a[k])) return a[k];
  return NaN;
}

// Class places, gap to the class leader and interval to the car ahead, from
// when each car passed the same progress (timing-loop gaps, not speed guesses).
// They change only when the update does, so the last update's are kept: the
// screen asks per animation frame, the work is per 5 Hz sample.
interface Standings {
  u: number;
  classPlace: Int16Array;
  gapS: Float32Array;
  intervalS: Float32Array;
  lapsDown: Int16Array;
}
const lastStandings = new WeakMap<RacePrep, Standings>();

function standingsAt(prep: RacePrep, u: number): Standings {
  const cached = lastStandings.get(prep);
  if (cached && cached.u === u) return cached;
  const {field} = prep;
  const n = field.cars.length;
  const out: Standings = {
    u,
    classPlace: new Int16Array(n),
    gapS: new Float32Array(n).fill(NaN),
    intervalS: new Float32Array(n).fill(NaN),
    lapsDown: new Int16Array(n),
  };
  const nowS = field.timeS[u];
  const byClass = new Map<string, number[]>();
  field.cars.forEach((c, i) => {
    if (prep.firstSeen[i] > u || stateOf(prep, i, u) === 'garage') return;
    const list = byClass.get(c.carClass) ?? [];
    list.push(i);
    byClass.set(c.carClass, list);
  });
  for (const list of byClass.values()) {
    list.sort((a, b) => field.cars[a].place[u] - field.cars[b].place[u]);
    list.forEach((i, k) => {
      out.classPlace[i] = k + 1;
      if (k === 0) {
        out.gapS[i] = 0;
        return;
      }
      const p = prep.progressM[i][u];
      const tLeader = timeAtProgress(prep, list[0], p, u);
      if (tLeader !== null) out.gapS[i] = Math.max(0, nowS - tLeader);
      const tAhead = timeAtProgress(prep, list[k - 1], p, u);
      if (tAhead !== null) out.intervalS[i] = Math.max(0, nowS - tAhead);
      // Whole laps of distance behind the leader: a lapped car's time gap is
      // real time, so it is the distance that says it is a lap down.
      const behindM = prep.progressM[list[0]][u] - p;
      if (prep.trackM > 0 && behindM >= prep.trackM)
        out.lapsDown[i] = Math.floor(behindM / prep.trackM);
    });
  }
  lastStandings.set(prep, out);
  return out;
}
