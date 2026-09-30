// The YOUR RACE lanes (handoff round 3 §R1a): the player's own race as spans
// of race time: in the pits, in a tow, in a battle, plus blue-flag onsets and
// passes. Pure TypeScript, erasable syntax only, type imports only: Node runs
// it (the parity test does).
//
// The rules are the uploader's (`tools/sessions/fieldTags.mjs`, which writes
// the per-lap facts behind the lap tags): a test runs both on one field and
// checks the lane totals against those facts, so the lanes and the tags
// cannot drift. Spans are runs of consecutive 5 Hz updates; each update counts
// for one update length, as in the facts.
import type {Field} from './field';
import type {RaceClock} from './raceClock';

// Same lane: lateral centre lines within this many metres.
export const SAME_LANE_M = 2;
export const BLUE_FLAG = 6;
// A battle is a same-class car within this many seconds on the road.
export const BATTLE_S = 1;
export const DRAFT_MAX_GAP_M = 30;
export const DRAFT_MIN_KMH = 200;
export const PASS_WINDOW_M = 150;
// Below this the time gap divides by a standing car: floor the speed.
const MIN_SPEED_MS = 20;

export interface Span {
  fromS: number;
  toS: number;
}

export interface RaceLanes {
  /** Race time of the last update plus one update, seconds. */
  durationS: number;
  /** Race time each of the player's laps starts; index i is lap i + 1. */
  lapStartsS: number[];
  pit: Span[];
  tow: Span[];
  battle: Span[];
  /** The start of each blue-flag stretch. */
  blueS: number[];
  /** Own-class passes; `made` is a pass by the player. */
  passes: {timeS: number; made: boolean}[];
}

const EMPTY: RaceLanes = {
  durationS: 0,
  lapStartsS: [],
  pit: [],
  tow: [],
  battle: [],
  blueS: [],
  passes: [],
};

// Signed on-road distance from a to b, in (-L/2, L/2]: positive when b is
// ahead of a.
function ahead(a: number, b: number, lapM: number): number {
  return ((((b - a) % lapM) + 1.5 * lapM) % lapM) - lapM / 2;
}

// Runs of consecutive true updates, as spans of race time.
function spansOf(on: Uint8Array, timeS: Float64Array, dtS: number): Span[] {
  const spans: Span[] = [];
  let start = -1;
  for (let u = 0; u <= on.length; u++) {
    if (u < on.length && on[u]) {
      if (start < 0) start = u;
    } else if (start >= 0) {
      spans.push({fromS: timeS[start], toS: timeS[u - 1] + dtS});
      start = -1;
    }
  }
  return spans;
}

export function raceLanes(field: Field, clock: RaceClock): RaceLanes {
  const me = field.cars.findIndex(c => c.player);
  const n = field.timeS.length;
  if (me < 0 || n === 0) return EMPTY;
  const player = field.cars[me];
  const dtS = 1 / field.hz;
  let lapM = 0;
  for (const c of field.cars) {
    for (const d of c.lapDistM) if (d > lapM) lapM = d;
  }
  if (lapM <= 0) return EMPTY;

  const tow = new Uint8Array(n);
  const battle = new Uint8Array(n);
  const pit = new Uint8Array(n);
  const blue: number[] = [];
  const passes: RaceLanes['passes'] = [];
  let blueOn = false;
  // Signed gaps to cars within PASS_WINDOW_M at the last update.
  let prevGap = new Map<number, number>();

  for (let u = 0; u < n; u++) {
    const here = player.lapDistM[u];
    if (player.inPits[u] === 1) pit[u] = 1;
    if (Number.isNaN(here) || player.inPits[u] === 1) {
      prevGap.clear();
      blueOn = false;
      continue;
    }
    const before = u > 0 ? player.lapDistM[u - 1] : NaN;
    const speedMs = Number.isNaN(before)
      ? null
      : ahead(before, here, lapM) / dtS;
    const speed = Math.max(speedMs ?? 0, MIN_SPEED_MS);

    let gapAhead = Infinity;
    let battleGapM = Infinity;
    const gapNow = new Map<number, number>();
    for (let j = 0; j < field.cars.length; j++) {
      const c = field.cars[j];
      const there = c.lapDistM[u];
      if (j === me || Number.isNaN(there) || c.inPits[u] === 1) continue;
      const g = ahead(here, there, lapM);
      const sameClass = c.carClass === player.carClass;
      if (sameClass) battleGapM = Math.min(battleGapM, Math.abs(g));
      if (Math.abs(g) < PASS_WINDOW_M) {
        gapNow.set(j, g);
        const last = prevGap.get(j);
        // Strictly across zero: a gap of exactly 0 m is neither side.
        if (last !== undefined && last * g < 0 && sameClass)
          passes.push({timeS: field.timeS[u], made: last > 0});
        if (g === 0 && last !== undefined) gapNow.set(j, last);
      }
      const lane = Math.abs(c.pathLateralM[u] - player.pathLateralM[u]);
      if (lane < SAME_LANE_M && g > 0) gapAhead = Math.min(gapAhead, g);
    }
    prevGap = gapNow;

    if (
      gapAhead <= DRAFT_MAX_GAP_M &&
      speedMs !== null &&
      speedMs * 3.6 > DRAFT_MIN_KMH
    )
      tow[u] = 1;
    if (battleGapM / speed < BATTLE_S) battle[u] = 1;
    const isBlue = player.flag[u] === BLUE_FLAG;
    if (isBlue && !blueOn) blue.push(field.timeS[u]);
    blueOn = isBlue;
  }

  const lapStartsS: number[] = [];
  let lastLap = 0;
  for (const lap of player.lapsDone) if (lap > lastLap) lastLap = lap;
  for (let lap = 0; lap <= lastLap; lap++) {
    const t = clock.timeAtLapDistance(lap, 0);
    if (t !== null) lapStartsS.push(t);
  }

  return {
    durationS: field.timeS[n - 1] + dtS,
    lapStartsS,
    pit: spansOf(pit, field.timeS, dtS),
    tow: spansOf(tow, field.timeS, dtS),
    battle: spansOf(battle, field.timeS, dtS),
    blueS: blue,
    passes,
  };
}

export type LaneZoom = 'race' | 'l10' | 'l3';

// Widths of the zoomed windows, R3: 10 laps is 1,080 s, 3 laps 325 s.
const ZOOM_S: Record<LaneZoom, number | null> = {
  race: null,
  l10: 1080,
  l3: 325,
};

/**
 * The window the lanes show: the whole race, or a fixed width centred on the
 * playhead and clamped to the race, so it never shows time before the start
 * or after the end.
 */
export function laneWindow(
  zoom: LaneZoom,
  playheadS: number,
  durationS: number,
): Span {
  const width = ZOOM_S[zoom];
  if (width === null || width >= durationS) return {fromS: 0, toS: durationS};
  const from = Math.min(Math.max(playheadS - width / 2, 0), durationS - width);
  return {fromS: from, toS: from + width};
}

/** Lap labels every 5 / 2 / 1 laps on the race, 10-lap and 3-lap windows. */
export function lapLabelEvery(zoom: LaneZoom): number {
  return zoom === 'race' ? 5 : zoom === 'l10' ? 2 : 1;
}
